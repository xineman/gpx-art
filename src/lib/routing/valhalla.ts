import type { LineString, Position } from 'geojson';
import { pathLength } from '$lib/geometry/distance';
import type { RouteRequest } from './types';

const TRACE_ATTRIBUTES = [
	'edge.length',
	'edge.begin_shape_index',
	'edge.end_shape_index',
	'shape',
	'matched.point',
	'matched.type',
	'matched.edge_index',
	'matched.begin_route_discontinuity',
	'matched.end_route_discontinuity',
	'matched.distance_along_edge'
];

type ValhallaMatchedPoint = {
	lat?: number;
	lon?: number;
	type?: string;
	begin_route_discontinuity?: boolean;
	end_route_discontinuity?: boolean;
};

type ValhallaTraceResponse = {
	error?: string;
	error_code?: number;
	status_code?: number;
	units?: string;
	shape?: string;
	edges?: Array<{ length?: number; begin_shape_index?: number; end_shape_index?: number }>;
	matched_points?: ValhallaMatchedPoint[];
	alternate_paths?: unknown[];
};

type ValhallaRouteResponse = {
	code?: string;
	routes?: Array<{ distance?: number; geometry?: LineString }>;
};

type GeometryGap = { startIndex: number; endIndex: number };

const MAX_GEOMETRY_GAP_REPAIRS = 4;

export type ValhallaFetchResult =
	| {
			ok: true;
			geometry: LineString;
			distanceM: number;
			waypoints: Position[];
	  }
	| { ok: false; error: string; status?: number };

export type ValhallaConfig = {
	baseUrl: string;
	userAgent: string;
	/** Optional inject for tests. */
	fetchFn?: typeof fetch;
};

function trimTrailingSlash(url: string) {
	return url.replace(/\/+$/, '');
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isNoMatchError(message: string) {
	return /no path|no suitable edges|unreachable|discontinu/i.test(message);
}

async function readJsonBody<T>(response: Response): Promise<T | null> {
	try {
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

function unreadableResponse(response: Response): Extract<ValhallaFetchResult, { ok: false }> {
	return response.ok
		? { ok: false, error: 'Routing server returned invalid JSON.', status: 502 }
		: {
				ok: false,
				error: `Routing server error (${response.status}).`,
				status: response.status
			};
}

function decodeValue(encoded: string, start: number): { value: number; next: number } | null {
	let result = 0;
	let shift = 0;
	let index = start;

	while (index < encoded.length && shift <= 30) {
		const value = encoded.charCodeAt(index++) - 63;
		if (value < 0 || value > 63) return null;
		result |= (value & 0x1f) << shift;
		if (value < 0x20) {
			return { value: result & 1 ? ~(result >> 1) : result >> 1, next: index };
		}
		shift += 5;
	}

	return null;
}

/** Decode Valhalla's six-decimal encoded route shape into GeoJSON `[lng, lat]` positions. */
export function decodePolyline6(encoded: string): Position[] | null {
	const coordinates: Position[] = [];
	let index = 0;
	let lat = 0;
	let lon = 0;

	while (index < encoded.length) {
		const latDelta = decodeValue(encoded, index);
		if (!latDelta) return null;
		const lonDelta = decodeValue(encoded, latDelta.next);
		if (!lonDelta) return null;

		lat += latDelta.value;
		lon += lonDelta.value;
		coordinates.push([lon / 1_000_000, lat / 1_000_000]);
		index = lonDelta.next;
	}

	return coordinates;
}

export function buildValhallaTraceUrl(baseUrl: string) {
	return `${trimTrailingSlash(baseUrl)}/trace_attributes`;
}

export function buildValhallaRouteUrl(baseUrl: string) {
	return `${trimTrailingSlash(baseUrl)}/route`;
}

/** Build the Valhalla map-matching body from an already validated route request. */
export function buildValhallaTraceBody(request: RouteRequest) {
	return {
		shape: request.vias.map(({ location, radiusM, bearing, bearingRange }) => ({
			lat: location[1],
			lon: location[0],
			...(radiusM == null ? {} : { radius: radiusM }),
			...(bearing == null ? {} : { heading: bearing, heading_tolerance: bearingRange ?? 45 })
		})),
		costing: 'bicycle',
		shape_match: 'map_snap',
		units: 'kilometers',
		trace_options: {
			search_radius: 100,
			gps_accuracy: 20,
			breakage_distance: 2_000
		},
		filters: {
			action: 'include',
			attributes: TRACE_ATTRIBUTES
		}
	};
}

function findGeometryGaps(body: ValhallaTraceResponse, coordinateCount: number): GeometryGap[] {
	const edges = body.edges ?? [];
	const gaps: GeometryGap[] = [];

	for (let index = 1; index < edges.length; index++) {
		const startIndex = edges[index - 1]?.end_shape_index;
		const endIndex = edges[index]?.begin_shape_index;
		if (
			Number.isInteger(startIndex) &&
			Number.isInteger(endIndex) &&
			startIndex !== endIndex &&
			startIndex! >= 0 &&
			endIndex! > startIndex! &&
			endIndex! < coordinateCount
		) {
			gaps.push({ startIndex: startIndex!, endIndex: endIndex! });
		}
	}

	return gaps;
}

function samePosition(a: Position, b: Position) {
	return a[0] === b[0] && a[1] === b[1];
}

function appendUnique(target: Position[], points: Position[]) {
	for (const point of points) {
		if (!target.length || !samePosition(target[target.length - 1]!, point)) target.push(point);
	}
}

async function fetchGapRoute(
	start: Position,
	end: Position,
	config: ValhallaConfig
): Promise<ValhallaFetchResult> {
	const fetchFn = config.fetchFn ?? fetch;
	let response: Response;
	try {
		response = await fetchFn(buildValhallaRouteUrl(config.baseUrl), {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': config.userAgent
			},
			body: JSON.stringify({
				locations: [
					{ lat: start[1], lon: start[0], type: 'break' },
					{ lat: end[1], lon: end[0], type: 'break' }
				],
				costing: 'bicycle',
				units: 'kilometers',
				format: 'osrm',
				shape_format: 'geojson'
			})
		});
	} catch {
		return { ok: false, error: 'Couldn’t reach the routing server.', status: 502 };
	}

	const body = await readJsonBody<ValhallaRouteResponse>(response);
	if (!body) return unreadableResponse(response);

	const route = body.routes?.[0];
	const geometry = route?.geometry;
	if (
		!response.ok ||
		body.code !== 'Ok' ||
		geometry?.type !== 'LineString' ||
		geometry.coordinates.length < 2
	) {
		return {
			ok: false,
			error: 'A gap in the sketch could not be connected using bike roads.',
			status: response.status
		};
	}
	const distanceM = isFiniteNumber(route?.distance)
		? route.distance
		: pathLength(geometry.coordinates);

	return {
		ok: true,
		geometry,
		distanceM,
		waypoints: [start, end]
	};
}

async function repairGeometryGaps(
	coordinates: Position[],
	body: ValhallaTraceResponse,
	config: ValhallaConfig
): Promise<
	| { ok: true; coordinates: Position[]; connectorDistanceM: number }
	| { ok: false; error: string; status?: number }
> {
	const gaps = findGeometryGaps(body, coordinates.length);
	if (gaps.length === 0) return { ok: true, coordinates, connectorDistanceM: 0 };
	if (gaps.length > MAX_GEOMETRY_GAP_REPAIRS) {
		return { ok: false, error: 'The sketch crosses too many gaps in the bike network.' };
	}

	const repaired: Position[] = [];
	let cursor = 0;
	let connectorDistanceM = 0;

	for (const gap of gaps) {
		appendUnique(repaired, coordinates.slice(cursor, gap.startIndex + 1));
		const connector = await fetchGapRoute(
			coordinates[gap.startIndex]!,
			coordinates[gap.endIndex]!,
			config
		);
		if (!connector.ok) return connector;
		appendUnique(repaired, connector.geometry.coordinates);
		connectorDistanceM += connector.distanceM;
		cursor = gap.endIndex + 1;
	}

	appendUnique(repaired, coordinates.slice(cursor));
	return { ok: true, coordinates: repaired, connectorDistanceM };
}

export async function fetchValhallaTrace(
	request: RouteRequest,
	config: ValhallaConfig
): Promise<ValhallaFetchResult> {
	if (request.vias.length < 2) {
		return { ok: false, error: 'Need a longer sketch to route.' };
	}

	const fetchFn = config.fetchFn ?? fetch;
	let activeRequest = request;
	let prunedUnmatchedPoints = false;

	while (true) {
		let response: Response;
		try {
			response = await fetchFn(buildValhallaTraceUrl(config.baseUrl), {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': config.userAgent
				},
				body: JSON.stringify(buildValhallaTraceBody(activeRequest))
			});
		} catch {
			return { ok: false, error: 'Couldn’t reach the routing server.', status: 502 };
		}

		const body = await readJsonBody<ValhallaTraceResponse>(response);
		if (!body) return unreadableResponse(response);

		if (!response.ok || body.error) {
			const message = body.error?.trim() ?? '';
			const status =
				response.ok && isFiniteNumber(body.status_code) ? body.status_code : response.status;
			return {
				ok: false,
				error: isNoMatchError(message)
					? 'No bike route found near that sketch — try closer to roads.'
					: message || `Routing server error (${response.status}).`,
				status
			};
		}

		if (body.alternate_paths?.length) {
			return { ok: false, error: 'The sketch crosses a gap in the bike network.' };
		}

		const matchedPoints = body.matched_points ?? [];
		const unmatchedIndexes = matchedPoints.flatMap((point, index) =>
			point.type === 'unmatched' ? [index] : []
		);
		const shouldPruneUnmatchedPoints =
			!prunedUnmatchedPoints &&
			matchedPoints.length === activeRequest.vias.length &&
			unmatchedIndexes.length > 0 &&
			activeRequest.vias.length - unmatchedIndexes.length >= 2;

		if (shouldPruneUnmatchedPoints) {
			const unmatched = new Set(unmatchedIndexes);
			activeRequest = {
				...activeRequest,
				vias: activeRequest.vias.filter((_, index) => !unmatched.has(index))
			};
			prunedUnmatchedPoints = true;
			continue;
		}

		if (
			matchedPoints.some(
				(point) =>
					point.type === 'unmatched' ||
					point.begin_route_discontinuity ||
					point.end_route_discontinuity
			)
		) {
			return { ok: false, error: 'The sketch could not be matched continuously to bike roads.' };
		}

		const coordinates = typeof body.shape === 'string' ? decodePolyline6(body.shape) : null;
		if (!coordinates) {
			return { ok: false, error: 'Routing server returned no geometry.' };
		}
		if (coordinates.length < 2) {
			return { ok: false, error: 'Routing server returned an empty path.' };
		}

		const repaired = await repairGeometryGaps(coordinates, body, config);
		if (!repaired.ok) return repaired;

		const snappedWaypoints = matchedPoints.map(({ lon, lat }) => [lon, lat] as Position);
		const waypoints =
			snappedWaypoints.length === activeRequest.vias.length &&
			snappedWaypoints.every(([lon, lat]) => isFiniteNumber(lon) && isFiniteNumber(lat))
				? snappedWaypoints
				: activeRequest.vias.map(({ location }) => location);
		const edgeDistanceKm = body.edges?.reduce(
			(sum, edge) => sum + (isFiniteNumber(edge.length) ? edge.length : 0),
			0
		);

		return {
			ok: true,
			geometry: { type: 'LineString', coordinates: repaired.coordinates },
			distanceM:
				edgeDistanceKm && edgeDistanceKm > 0
					? edgeDistanceKm * 1_000 + repaired.connectorDistanceM
					: pathLength(repaired.coordinates),
			waypoints
		};
	}
}
