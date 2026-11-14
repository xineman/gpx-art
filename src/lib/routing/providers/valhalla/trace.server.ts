import type { LineString, Position } from 'geojson';
import { pathLength } from '#lib/geometry/distance.js';
import { samePosition } from '#lib/geometry/position.js';
import type { RouteRequest } from '../../matching/types';
import { decodePolyline6 } from './polyline';
import {
	postValhalla,
	PROVIDER_UNAVAILABLE_STATUS,
	type ValhallaFailureReply
} from './http.server';
import type { ValhallaConfig } from './types.server';

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

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isNoMatchError(message: string) {
	return /no path|no suitable edges|unreachable|discontinu/i.test(message);
}

type ValhallaFetchFailure = Extract<ValhallaFetchResult, { ok: false }>;

/** Transport failures shared by trace and gap-repair requests. */
function transportFailure(
	reply: Exclude<ValhallaFailureReply, { reason: 'rejected' }>
): ValhallaFetchFailure {
	if (reply.reason === 'unreachable') {
		return { ok: false, error: 'Couldn’t reach the routing server.', status: reply.status };
	}
	return {
		ok: false,
		error: reply.httpOk
			? 'Routing server returned invalid JSON.'
			: `Routing server error (${reply.httpStatus}).`,
		status: reply.status
	};
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
	const reply = await postValhalla<ValhallaRouteResponse>(config, 'route', {
		locations: [
			{ lat: start[1], lon: start[0], type: 'break' },
			{ lat: end[1], lon: end[0], type: 'break' }
		],
		costing: 'bicycle',
		units: 'kilometers',
		format: 'osrm',
		shape_format: 'geojson'
	});
	if (!reply.ok && reply.reason !== 'rejected') return transportFailure(reply);

	const route = reply.ok ? reply.body.routes?.[0] : undefined;
	const geometry = route?.geometry;
	if (
		!reply.ok ||
		reply.body.code !== 'Ok' ||
		geometry?.type !== 'LineString' ||
		geometry.coordinates.length < 2
	) {
		return {
			ok: false,
			error: 'A gap in the sketch could not be connected using bike roads.',
			status: reply.ok ? PROVIDER_UNAVAILABLE_STATUS : reply.status
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

	let activeRequest = request;
	let prunedUnmatchedPoints = false;

	while (true) {
		const reply = await postValhalla<ValhallaTraceResponse>(
			config,
			'trace_attributes',
			buildValhallaTraceBody(activeRequest)
		);
		if (!reply.ok) {
			if (reply.reason !== 'rejected') return transportFailure(reply);
			return {
				ok: false,
				error: isNoMatchError(reply.message)
					? 'No bike route found near that sketch — try closer to roads.'
					: reply.message || `Routing server error (${reply.httpStatus}).`,
				status: reply.status
			};
		}
		const body = reply.body;

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
