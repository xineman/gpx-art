import {
	OSRM_BASE_URL,
	OSRM_PROFILE,
	PENCIL_MAX_VIAS,
	PENCIL_ROUTE_RDP_TOLERANCE
} from '$lib/constants/routing';
import type { Point } from '$lib/types/sketch';
import { simplifyRdp } from './rdp';

// ---------------------------------------------------------------------------
// /table — road-network pairwise distances for TSP transition costs
// ---------------------------------------------------------------------------

// Fetch an N×N road-distance matrix (meters) via OSRM /table.
// `distances[i][j]` is the bike-network length from points[i] to points[j].
// Throws on HTTP / OSRM errors; callers that want haversine fallback catch.
export async function getDistanceTable(points: Point[]): Promise<number[][]> {
	if (points.length === 0) return [];
	if (points.length === 1) return [[0]];

	const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
	const url = `${OSRM_BASE_URL}/table/v1/${OSRM_PROFILE}/${coords}?annotations=distance`;

	const response = await fetch(url, { headers: { Accept: 'application/json' } });
	if (!response.ok) {
		throw new Error(`OSRM table request failed: ${response.status} ${response.statusText}`);
	}

	const body = (await response.json()) as OsrmTableResponse;
	if (body.code !== 'Ok') {
		throw new Error(
			`OSRM table error: ${body.code}${body.message ? ` — ${body.message}` : ''}`
		);
	}
	if (!body.distances || body.distances.length !== points.length) {
		throw new Error('OSRM table returned an unexpected distances matrix.');
	}

	return body.distances.map((row) =>
		row.map((d) => (d === null || !Number.isFinite(d) ? Infinity : d))
	);
}

export type RouteResult = {
	geometry: string;
	distance: number;
	duration: number;
};

export type RouteBearing = { bearing: number; range: number };

export type GetRouteOptions = {
	// Force the route to keep going straight at intermediate waypoints
	// (no U-turn even if faster). Essential for multi-via structured edges.
	continueStraight?: boolean;
	// Per-waypoint OSRM bearings constraint. null = unconstrained.
	// When set and the request fails, getRoute retries once without bearings.
	bearings?: Array<RouteBearing | null>;
};

// Thin wrapper around OSRM /route. Waypoints are ordered — this function does
// NOT solve the TSP. For TSP solving, see ./tsp.ts and the createRoute()
// pipeline in state.svelte.ts which first solves cluster ordering and then
// invokes getRoute per shape plus per transition.
//
// overview=full keeps every road segment in the response (the simplified
// default would produce wobbly GPX tracks).
// geometries=polyline returns Google's precision-5 encoded polyline, decoded
// by ./polyline.ts.
// steps=false keeps the response payload small — we don't render turn-by-turn.
//
// We deliberately omit the `radiuses=` parameter: when it's missing, OSRM's
// `/route` default is effectively unlimited per-waypoint snapping, which is
// what we want after RDP simplification has already cut the input down to a
// handful of geometric anchors. Passing an explicit finite radius would
// re-introduce `NoSegment` failures for mid-block anchors; passing
// `radiuses=0` would demand exact road matches and break those same anchors.
//
// Multi-via structured shapes pass continueStraight + sketch-aligned bearings
// so OSRM does not reverse at each intermediate snap.
export async function getRoute(points: Point[], options: GetRouteOptions = {}): Promise<RouteResult> {
	if (points.length < 2) {
		throw new Error('OSRM /route requires at least 2 waypoints.');
	}

	try {
		return await fetchRoute(points, options);
	} catch (err) {
		// Bearings can be too tight against OSM geometry — fall back once.
		if (options.bearings && options.bearings.length > 0) {
			const { bearings: _b, ...rest } = options;
			return fetchRoute(points, rest);
		}
		throw err;
	}
}

async function fetchRoute(points: Point[], options: GetRouteOptions): Promise<RouteResult> {
	const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
	const params = new URLSearchParams({
		overview: 'full',
		geometries: 'polyline',
		steps: 'false'
	});

	// Only meaningful with intermediate waypoints; still safe for 2-point.
	if (options.continueStraight ?? points.length > 2) {
		params.set('continue_straight', 'true');
	}

	if (options.bearings && options.bearings.length === points.length) {
		params.set(
			'bearings',
			options.bearings
				.map((b) => (b ? `${Math.round(b.bearing)},${Math.round(b.range)}` : ''))
				.join(';')
		);
	}

	const url = `${OSRM_BASE_URL}/route/v1/${OSRM_PROFILE}/${coords}?${params.toString()}`;

	const response = await fetch(url, { headers: { Accept: 'application/json' } });
	if (!response.ok) {
		throw new Error(`OSRM request failed: ${response.status} ${response.statusText}`);
	}

	const body = (await response.json()) as OsrmRouteResponse;
	if (body.code !== 'Ok') {
		throw new Error(`OSRM returned error: ${body.code}${body.message ? ` — ${body.message}` : ''}`);
	}

	const route = body.routes[0];
	if (!route) {
		throw new Error('OSRM returned no route.');
	}

	return {
		geometry: route.geometry,
		distance: route.distance,
		duration: route.duration
	};
}

// Collapse a densified pencil trace to a short list of hard vias for /route.
// Endpoints always survive; interiors come from a higher-tolerance RDP pass
// and are capped so /route cannot weave through every sample.
export function pencilRouteAnchors(
	points: Point[],
	toleranceMeters = PENCIL_ROUTE_RDP_TOLERANCE,
	maxVias = PENCIL_MAX_VIAS
): Point[] {
	if (points.length < 2) return points.slice();
	if (maxVias < 2) {
		throw new Error('Pencil max vias must be at least 2.');
	}

	let anchors = simplifyRdp(points, toleranceMeters);
	if (anchors.length < 2) {
		anchors = [points[0], points[points.length - 1]];
	}
	// RDP can drop endpoint object identity — force original ends.
	anchors[0] = points[0];
	anchors[anchors.length - 1] = points[points.length - 1];

	if (anchors.length <= maxVias) return anchors;

	const subsampled: Point[] = [];
	for (let i = 0; i < maxVias; i++) {
		const idx = Math.round((i * (anchors.length - 1)) / (maxVias - 1));
		subsampled.push(anchors[idx]);
	}
	return subsampled;
}

type OsrmRouteResponse = {
	code: string;
	message?: string;
	routes: Array<{
		geometry: string;
		distance: number;
		duration: number;
	}>;
};

type OsrmTableResponse = {
	code: string;
	message?: string;
	// null when OSRM cannot route between a pair
	distances?: Array<Array<number | null>>;
};
