import type { Position } from 'geojson';
import { MAX_VIAS, MIN_VIAS } from '$lib/config/routing';
import { buildShapeOptimizationProblem } from './optimization-problem';
import { optimizeShapeOrder } from './optimize';
import { fetchOsrmDistanceTable, fetchOsrmRoute, type OsrmConfig } from './osrm';
import type {
	OptimizedRouteRequest,
	PreparedRouteShape,
	RouteApiRequest,
	RouteRequest,
	RouteResponse,
	RouteVia
} from './types';

export type GenerateRouteOptions = {
	osrm: OsrmConfig;
};

export type ParsedRouteRequest = { ok: true; request: RouteRequest } | { ok: false; error: string };
export type ParsedOptimizedRouteRequest =
	{ ok: true; request: OptimizedRouteRequest } | { ok: false; error: string };
export type ParsedRouteApiRequest =
	{ ok: true; request: RouteApiRequest } | { ok: false; error: string };

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function sameLocation(a: RouteVia, b: RouteVia): boolean {
	return a.location[0] === b.location[0] && a.location[1] === b.location[1];
}

function samePosition(a: Position, b: Position): boolean {
	return a[0] === b[0] && a[1] === b[1];
}

function inCoordinateRange([lng, lat]: Position): boolean {
	return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
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
 * Parse and sanitize the public route API payload before it reaches OSRM.
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

	if ('continueStraight' in value && typeof value.continueStraight !== 'boolean') {
		return { ok: false, error: 'continueStraight must be a boolean.' };
	}

	const distinctVias = dedupeConsecutiveVias(parsedVias);
	if (distinctVias.length < MIN_VIAS) {
		return { ok: false, error: 'Need at least two distinct waypoints.' };
	}

	return {
		ok: true,
		request: {
			vias: distinctVias,
			...(typeof value.continueStraight === 'boolean'
				? { continueStraight: value.continueStraight }
				: {})
		}
	};
}

/** Parse grouped sketch shapes for server-side order optimization. */
export function parseOptimizedRouteRequest(value: unknown): ParsedOptimizedRouteRequest {
	if (!isRecord(value) || !Array.isArray(value.shapes)) {
		return { ok: false, error: 'Body must include a shapes array.' };
	}
	if (value.shapes.length === 0) {
		return { ok: false, error: 'Request needs at least one shape.' };
	}

	const shapes: PreparedRouteShape[] = [];
	let totalVias = 0;
	for (let shapeIndex = 0; shapeIndex < value.shapes.length; shapeIndex++) {
		const rawShape = value.shapes[shapeIndex];
		if (
			!isRecord(rawShape) ||
			typeof rawShape.closed !== 'boolean' ||
			!Array.isArray(rawShape.vias)
		) {
			return { ok: false, error: `Shape ${shapeIndex} is invalid.` };
		}
		const minimum = rawShape.closed ? MIN_VIAS + 1 : MIN_VIAS;
		if (rawShape.vias.length < minimum) {
			return { ok: false, error: `Shape ${shapeIndex} needs at least ${minimum} waypoints.` };
		}

		const vias: Position[] = [];
		for (let viaIndex = 0; viaIndex < rawShape.vias.length; viaIndex++) {
			const rawVia = rawShape.vias[viaIndex];
			if (!isFinitePosition(rawVia)) {
				return {
					ok: false,
					error: `Shape ${shapeIndex} waypoint ${viaIndex} is not a valid [lng, lat].`
				};
			}
			const position: Position = [rawVia[0], rawVia[1]];
			if (!inCoordinateRange(position)) {
				return { ok: false, error: `Shape ${shapeIndex} waypoint ${viaIndex} is out of range.` };
			}
			vias.push(position);
		}

		if (rawShape.closed && !samePosition(vias[0]!, vias[vias.length - 1]!)) {
			return { ok: false, error: `Shape ${shapeIndex} must repeat its first waypoint to close.` };
		}
		const unique = new Set(vias.map((position) => `${position[0]},${position[1]}`));
		if (unique.size < MIN_VIAS) {
			return { ok: false, error: `Shape ${shapeIndex} needs at least two distinct waypoints.` };
		}

		totalVias += vias.length;
		if (totalVias > MAX_VIAS) {
			return { ok: false, error: `Route has too many waypoints (max ${MAX_VIAS}).` };
		}
		shapes.push({ vias, closed: rawShape.closed });
	}

	return { ok: true, request: { shapes } };
}

/** Parse either the ordered refinement form or grouped optimization form. */
export function parseRouteApiRequest(value: unknown): ParsedRouteApiRequest {
	return isRecord(value) && 'shapes' in value
		? parseOptimizedRouteRequest(value)
		: parseRouteRequest(value);
}

function requestFromPositions(points: Position[]): RouteRequest {
	return { vias: points.map((location) => ({ location })) };
}

/**
 * Server pipeline: optimize grouped shapes when requested, then send one
 * continuous ordered route to OSRM. Ordered refinement requests skip Table.
 */
export async function generateRoute(
	request: RouteApiRequest,
	options: GenerateRouteOptions
): Promise<RouteResponse> {
	let orderedRequest: RouteRequest;
	if ('shapes' in request) {
		if (request.shapes.length === 1) {
			orderedRequest = requestFromPositions(request.shapes[0]!.vias);
		} else {
			const problem = buildShapeOptimizationProblem(request.shapes);
			const table = await fetchOsrmDistanceTable(problem.coordinates, options.osrm);
			if (!table.ok) return table;
			const optimized = optimizeShapeOrder(problem, table.distances);
			if (!optimized.ok) return optimized;
			orderedRequest = requestFromPositions(optimized.vias);
		}
	} else {
		orderedRequest = request;
	}

	const osrm = await fetchOsrmRoute(orderedRequest, options.osrm);
	if (!osrm.ok) return osrm;

	return {
		ok: true,
		geometry: osrm.geometry,
		distanceM: osrm.distanceM,
		waypoints: osrm.waypoints
	};
}
