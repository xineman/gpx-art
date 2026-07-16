import type { Position } from 'geojson';
import { MAX_VIAS, MIN_VIAS } from '$lib/config/routing';
import { fetchOsrmRoute, type OsrmConfig } from './osrm';
import type { RouteLegInput, RouteResponse } from './types';

export type GenerateRouteOptions = {
	osrm: OsrmConfig;
};

function isFinitePosition(p: unknown): p is Position {
	return (
		Array.isArray(p) &&
		p.length >= 2 &&
		typeof p[0] === 'number' &&
		typeof p[1] === 'number' &&
		Number.isFinite(p[0]) &&
		Number.isFinite(p[1])
	);
}

function dedupeConsecutivePositions(points: Position[]): Position[] {
	if (points.length === 0) return [];
	const out: Position[] = [points[0]!];
	for (let index = 1; index < points.length; index++) {
		const point = points[index]!;
		const previous = out[out.length - 1]!;
		if (point[0] !== previous[0] || point[1] !== previous[1]) out.push(point);
	}
	return out;
}

/**
 * Validate client-prepared legs before calling OSRM.
 * Returns a friendly error string or null when OK.
 */
export function validateRouteLegs(legs: unknown): string | null {
	if (!Array.isArray(legs) || legs.length === 0) {
		return 'Request must include at least one route leg.';
	}

	for (let i = 0; i < legs.length; i++) {
		const leg = legs[i];
		if (!leg || typeof leg !== 'object') {
			return `Leg ${i} is invalid.`;
		}
		const vias = (leg as RouteLegInput).vias;
		if (!Array.isArray(vias) || vias.length < MIN_VIAS) {
			return `Leg ${i} needs at least ${MIN_VIAS} waypoints.`;
		}
		if (vias.length > MAX_VIAS) {
			return `Leg ${i} has too many waypoints (max ${MAX_VIAS}).`;
		}
		for (let j = 0; j < vias.length; j++) {
			if (!isFinitePosition(vias[j])) {
				return `Leg ${i} waypoint ${j} is not a valid [lng, lat].`;
			}
			const [lng, lat] = vias[j] as Position;
			if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
				return `Leg ${i} waypoint ${j} is out of range.`;
			}
		}
	}

	const vias = dedupeConsecutivePositions((legs as RouteLegInput[]).flatMap((leg) => leg.vias));
	if (vias.length < MIN_VIAS) {
		return 'Need at least two distinct waypoints.';
	}
	if (vias.length > MAX_VIAS) {
		return `Route has too many waypoints (max ${MAX_VIAS}).`;
	}

	return null;
}

/**
 * Server pipeline: ordered prepared via legs → one continuous OSRM route.
 */
export async function generateRouteFromLegs(
	legs: RouteLegInput[],
	options: GenerateRouteOptions
): Promise<RouteResponse> {
	const validationError = validateRouteLegs(legs);
	if (validationError) {
		return { ok: false, error: validationError };
	}

	const vias = dedupeConsecutivePositions(legs.flatMap((leg) => leg.vias));
	const osrm = await fetchOsrmRoute(vias, options.osrm);
	if (!osrm.ok) return osrm;

	return {
		ok: true,
		geometry: osrm.geometry,
		distanceM: osrm.distanceM,
		provider: 'osrm-route',
		viaCount: vias.length
	};
}
