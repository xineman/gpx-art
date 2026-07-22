import { MAX_VIAS, MIN_VIAS } from '$lib/config/routing';
import type { RouteRequest, RouteResponse, RouteVia } from '../types';
import { fetchValhallaTrace, type ValhallaConfig } from '../valhalla';
import { inCoordinateRange, isFinitePosition, isRecord } from './validation.server';

export type GenerateRouteOptions = {
	valhalla: ValhallaConfig;
};

export type ParsedRouteRequest = { ok: true; request: RouteRequest } | { ok: false; error: string };

function sameLocation(a: RouteVia, b: RouteVia): boolean {
	return a.location[0] === b.location[0] && a.location[1] === b.location[1];
}

function dedupeConsecutiveVias(vias: RouteVia[]): RouteVia[] {
	const distinct: RouteVia[] = [];
	for (const via of vias) {
		const previous = distinct.at(-1);
		if (!previous || !sameLocation(previous, via)) distinct.push(via);
	}
	return distinct;
}

/**
 * Parse and sanitize the public route API payload before it reaches Valhalla.
 */
export function parseRouteRequest(value: unknown): ParsedRouteRequest {
	if (!isRecord(value) || !Array.isArray(value.vias)) {
		return { ok: false, error: 'Body must include a vias array of waypoint objects.' };
	}

	const vias = value.vias;
	if (vias.length < MIN_VIAS) {
		return { ok: false, error: `Request needs at least ${MIN_VIAS} waypoints.` };
	}
	if (vias.length > MAX_VIAS) {
		return { ok: false, error: `Route has too many waypoints (max ${MAX_VIAS}).` };
	}

	const parsedVias: RouteVia[] = [];
	for (let index = 0; index < vias.length; index++) {
		const rawVia = vias[index];
		if (!isRecord(rawVia) || !isFinitePosition(rawVia.location)) {
			return { ok: false, error: `Waypoint ${index} is not a valid [lng, lat].` };
		}

		const [lng, lat] = rawVia.location;
		if (!inCoordinateRange([lng, lat])) {
			return { ok: false, error: `Waypoint ${index} is out of range.` };
		}

		const via: RouteVia = { location: [lng, lat] };
		if ('radiusM' in rawVia) {
			if (
				typeof rawVia.radiusM !== 'number' ||
				!Number.isFinite(rawVia.radiusM) ||
				rawVia.radiusM < 0
			) {
				return { ok: false, error: `Waypoint ${index} has an invalid snapping radius.` };
			}
			via.radiusM = rawVia.radiusM;
		}
		if ('bearing' in rawVia) {
			if (
				typeof rawVia.bearing !== 'number' ||
				!Number.isInteger(rawVia.bearing) ||
				rawVia.bearing < 0 ||
				rawVia.bearing > 360
			) {
				return { ok: false, error: `Waypoint ${index} has an invalid bearing.` };
			}
			via.bearing = rawVia.bearing;
		}
		if ('bearingRange' in rawVia) {
			if (
				via.bearing == null ||
				typeof rawVia.bearingRange !== 'number' ||
				!Number.isInteger(rawVia.bearingRange) ||
				rawVia.bearingRange < 0 ||
				rawVia.bearingRange > 180
			) {
				return { ok: false, error: `Waypoint ${index} has an invalid bearing range.` };
			}
			via.bearingRange = rawVia.bearingRange;
		}
		parsedVias.push(via);
	}

	const distinctVias = dedupeConsecutiveVias(parsedVias);
	if (distinctVias.length < MIN_VIAS) {
		return { ok: false, error: 'Need at least two distinct waypoints.' };
	}

	return {
		ok: true,
		request: { vias: distinctVias }
	};
}

/**
 * Server pipeline: ordered prepared vias → one continuous Valhalla map match.
 */
export async function generateRoute(
	request: RouteRequest,
	options: GenerateRouteOptions
): Promise<RouteResponse> {
	const matched = await fetchValhallaTrace(request, options.valhalla);
	if (!matched.ok) return matched;

	return {
		ok: true,
		geometry: matched.geometry,
		distanceM: matched.distanceM,
		waypoints: matched.waypoints
	};
}
