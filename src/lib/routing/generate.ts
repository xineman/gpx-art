import type { Position } from 'geojson';
import { MAX_VIAS, MIN_VIAS } from '$lib/config/routing';
import { fetchOsrmRoute, type OsrmConfig } from './osrm';
import {
	ensureClosedLoop,
	measureRouteDistanceM,
	stitchCoordinates,
	toLineString
} from './postprocess';
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

	return null;
}

/**
 * Server pipeline: prepared via legs → OSRM Route per leg → stitched LineString.
 */
export async function generateRouteFromLegs(
	legs: RouteLegInput[],
	options: GenerateRouteOptions
): Promise<RouteResponse> {
	const validationError = validateRouteLegs(legs);
	if (validationError) {
		return { ok: false, error: validationError };
	}

	const parts: Position[][] = [];
	let totalDistance = 0;
	let viaCount = 0;
	let anyClosed = false;

	for (const leg of legs) {
		const vias = leg.vias;
		const closed = Boolean(leg.closed);
		viaCount += vias.length;
		anyClosed = anyClosed || closed;

		const osrm = await fetchOsrmRoute(vias, options.osrm);
		if (!osrm.ok) {
			if (legs.length === 1) return osrm;
			continue;
		}

		let coords = osrm.geometry.coordinates;
		coords = ensureClosedLoop(coords, closed);
		parts.push(coords);
		totalDistance += measureRouteDistanceM(coords, osrm.distanceM);
	}

	if (parts.length === 0) {
		return { ok: false, error: 'Couldn’t build a route from that sketch.' };
	}

	const closed = legs.length === 1 && anyClosed;
	const stitched = ensureClosedLoop(stitchCoordinates(parts), closed);
	const geometry = toLineString(stitched);

	if (geometry.coordinates.length < 2) {
		return { ok: false, error: 'Couldn’t build a route from that sketch.' };
	}

	return {
		ok: true,
		geometry,
		distanceM: measureRouteDistanceM(geometry.coordinates, totalDistance),
		provider: 'osrm-route',
		viaCount
	};
}
