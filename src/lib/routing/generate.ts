import type { Position } from 'geojson';
import { MAX_VIAS, MIN_VIAS } from '$lib/config/routing';
import { fetchOsrmRoute, type OsrmConfig } from './osrm';
import type { RouteResponse } from './types';

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
 * Validate client-prepared vias before calling OSRM.
 * Returns a friendly error string or null when OK.
 */
export function validateRouteVias(vias: unknown): string | null {
	if (!Array.isArray(vias) || vias.length < MIN_VIAS) {
		return `Request needs at least ${MIN_VIAS} waypoints.`;
	}
	if (vias.length > MAX_VIAS) {
		return `Route has too many waypoints (max ${MAX_VIAS}).`;
	}

	for (let index = 0; index < vias.length; index++) {
		if (!isFinitePosition(vias[index])) {
			return `Waypoint ${index} is not a valid [lng, lat].`;
		}
		const [lng, lat] = vias[index] as Position;
		if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
			return `Waypoint ${index} is out of range.`;
		}
	}

	const distinctVias = dedupeConsecutivePositions(vias as Position[]);
	if (distinctVias.length < MIN_VIAS) {
		return 'Need at least two distinct waypoints.';
	}

	return null;
}

/**
 * Server pipeline: ordered prepared vias → one continuous OSRM route.
 */
export async function generateRoute(
	vias: Position[],
	options: GenerateRouteOptions
): Promise<RouteResponse> {
	const validationError = validateRouteVias(vias);
	if (validationError) {
		return { ok: false, error: validationError };
	}

	const distinctVias = dedupeConsecutivePositions(vias);
	const osrm = await fetchOsrmRoute(distinctVias, options.osrm);
	if (!osrm.ok) return osrm;

	return {
		ok: true,
		geometry: osrm.geometry,
		distanceM: osrm.distanceM
	};
}
