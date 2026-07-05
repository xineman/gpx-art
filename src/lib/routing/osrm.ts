import { OSRM_BASE_URL, OSRM_PROFILE } from '$lib/constants/routing';
import type { Point } from '$lib/types/sketch';

export type RouteResult = {
	geometry: string;
	distance: number;
	duration: number;
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
export async function getRoute(points: Point[]): Promise<RouteResult> {
	if (points.length < 2) {
		throw new Error('OSRM /route requires at least 2 waypoints.');
	}

	const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
	const url = `${OSRM_BASE_URL}/route/v1/${OSRM_PROFILE}/${coords}?overview=full&geometries=polyline&steps=false`;

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

type OsrmRouteResponse = {
	code: string;
	message?: string;
	routes: Array<{
		geometry: string;
		distance: number;
		duration: number;
	}>;
};
