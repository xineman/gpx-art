import {
	DETOUR_RATIO,
	MATCH_CHUNK_OVERLAP,
	MATCH_FALLBACK_MAX_VIAS,
	MATCH_FALLBACK_RDP_TOLERANCE,
	MATCH_MAX_POINTS,
	MATCH_RADIUS_METERS,
	MATCH_RADIUS_WAYPOINT_METERS,
	OSRM_BASE_URL,
	OSRM_PROFILE
} from '$lib/constants/routing';
import { totalDistance } from '$lib/geometry/distance';
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

// Per-chunk outcome for a /match call: either the match was used as-is
// (with the avg confidence across its matchings) or the pipeline fell
// through to sparse /route. Surfaced via the batch debug legend.
//
// `code`:
//   - NoMatch — OSRM rejected the chunk (waypoint outside radius)
//   - Detour  — match succeeded but geometry was pathologically longer than
//               the sketch / a sparse-route baseline
export type ChunkOutcome =
	| { kind: 'matched'; confidence: number }
	| { kind: 'fallback'; code: 'NoMatch' | 'Detour' };

export type MatchResult = {
	geometries: string[];
	distance: number;
	duration: number;
	confidence: number;
	// One entry per chunk dispatched, in dispatch order. For chunk-level
	// callers this is always a single-element array; getMatchedRoute
	// concatenates them into the final per-shape list.
	chunkOutcomes: ChunkOutcome[];
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

// Map-match a hand-drawn (or densified) trace to the road network.
//
// OSRM /match is better suited than /route for dense sketch points because it
// treats the input as a noisy trace and can drop outliers (`tracepoints: null`)
// instead of forcing the route through every anchor. The public demo endpoint
// allows only small traces, so split longer shapes into overlapping chunks.
//
// Per chunk: /match → optional detour-ratio reject → sparse /route fallback
// on NoMatch or Detour (never full-chunk hard vias).
//
// Chunks are dispatched in parallel. Promise.all preserves fail-fast
// semantics (one chunk's hard error aborts createRoute).
export async function getMatchedRoute(points: Point[]): Promise<MatchResult> {
	if (points.length < 2) {
		throw new Error('OSRM /match requires at least 2 trace points.');
	}

	const chunks = chunkPointsForMatch(points);
	const results = await Promise.all(chunks.map((chunk) => getBestRouteForChunk(chunk)));

	const geometries: string[] = [];
	const chunkOutcomes: ChunkOutcome[] = [];
	let distance = 0;
	let duration = 0;
	let confidenceSum = 0;
	let matchingCount = 0;
	for (const result of results) {
		geometries.push(...result.geometries);
		chunkOutcomes.push(...result.chunkOutcomes);
		distance += result.distance;
		duration += result.duration;
		confidenceSum += result.confidence * result.geometries.length;
		matchingCount += result.geometries.length;
	}

	return {
		geometries,
		distance,
		duration,
		confidence: matchingCount > 0 ? confidenceSum / matchingCount : 0,
		chunkOutcomes
	};
}

export function chunkPointsForMatch(
	points: Point[],
	maxPoints = MATCH_MAX_POINTS,
	overlap = MATCH_CHUNK_OVERLAP
): Point[][] {
	if (maxPoints < 2) {
		throw new Error('OSRM match chunks must allow at least 2 points.');
	}
	if (overlap < 0 || overlap >= maxPoints) {
		throw new Error('OSRM match chunk overlap must be between 0 and maxPoints - 1.');
	}
	if (points.length <= maxPoints) return [points.slice()];

	const chunks: Point[][] = [];
	const stride = maxPoints - overlap;
	for (let start = 0; start < points.length - 1; start += stride) {
		let end = Math.min(points.length, start + maxPoints);
		if (end === points.length && end - start === 2 && chunks.length > 0) {
			start = Math.max(0, points.length - 3);
			end = points.length;
		}

		const chunk = points.slice(start, end);
		if (chunk.length >= 2) chunks.push(chunk);
		if (end === points.length) break;
	}
	return chunks;
}

// Collapse a densified chunk to a short list of hard vias for /route fallback.
// Endpoints always survive; interiors come from a high-tolerance RDP pass and
// are capped so /route cannot weave through every sample.
export function sparseFallbackAnchors(
	points: Point[],
	toleranceMeters = MATCH_FALLBACK_RDP_TOLERANCE,
	maxVias = MATCH_FALLBACK_MAX_VIAS
): Point[] {
	if (points.length < 2) return points.slice();
	if (maxVias < 2) {
		throw new Error('Fallback max vias must be at least 2.');
	}

	let anchors = simplifyRdp(points, toleranceMeters);
	if (anchors.length < 2) {
		anchors = [points[0], points[points.length - 1]];
	}
	// RDP can drop a shared endpoint reference equality — force ends to the
	// original chunk endpoints so stitched chunks still join.
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

// Pure decision helper for the detour gate (unit-tested without fetch).
// Reject when the matched path is longer than ratio × the better of sketch
// length and a sparse-route baseline. Intentional curves inflate L_sketch,
// so they survive; plaza loops inflate only L_match.
export function isPathologicalDetour(
	matchDistance: number,
	sketchDistance: number,
	sparseRouteDistance: number,
	ratio = DETOUR_RATIO
): boolean {
	const baseline = Math.max(sketchDistance, sparseRouteDistance, 1);
	return matchDistance > ratio * baseline;
}

export function matchingIndexesInTraceOrder(
	tracepoints: Array<OsrmMatchTracepoint | null>,
	matchingCount: number
): number[] {
	const seen = new Set<number>();
	const indexes: number[] = [];

	for (const tracepoint of tracepoints) {
		if (!tracepoint) continue;
		const index = tracepoint.matchings_index;
		if (index < 0 || index >= matchingCount || seen.has(index)) continue;
		seen.add(index);
		indexes.push(index);
	}

	for (let i = 0; i < matchingCount; i++) {
		if (!seen.has(i)) indexes.push(i);
	}

	return indexes;
}

async function getBestRouteForChunk(points: Point[]): Promise<MatchResult> {
	try {
		const matched = await getMatchChunk(points);
		return await maybeRejectDetour(matched, points);
	} catch (err) {
		// Whole chunk rejected because a waypoint couldn't snap inside its
		// radius. Sparse /route (not full-chunk vias) keeps shape without
		// turning soft tracepoints into mandatory stops.
		if (err instanceof OsrmApiError && err.code === 'NoMatch') {
			return getSparseRouteAsMatchResult(points, 'NoMatch');
		}
		throw err;
	}
}

async function maybeRejectDetour(matched: MatchResult, points: Point[]): Promise<MatchResult> {
	const sketchDistance = totalDistance(points);
	// Fast path: matched length is plausible vs the input polyline — no
	// extra network call. Intentional curves have large sketchDistance.
	if (matched.distance <= DETOUR_RATIO * Math.max(sketchDistance, 1)) {
		return matched;
	}

	const anchors = sparseFallbackAnchors(points);
	const sparse = await getRoute(anchors);
	if (isPathologicalDetour(matched.distance, sketchDistance, sparse.distance)) {
		return {
			geometries: [sparse.geometry],
			distance: sparse.distance,
			duration: sparse.duration,
			confidence: 1,
			chunkOutcomes: [{ kind: 'fallback', code: 'Detour' }]
		};
	}
	return matched;
}

async function getMatchChunk(points: Point[]): Promise<MatchResult> {
	const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
	// Per-coordinate radius: waypoints (index 0 and length-1) get the relaxed
	// MATCH_RADIUS_WAYPOINT_METERS so anchors 25-50 m off the road network
	// (plaza boundaries, park entrances) still snap — without this, a chunk
	// whose start/end anchor is just outside the 30 m tracepoint radius
	// returns NoMatch for the whole chunk and we lose the curve detail.
	// Tracepoints keep the tight 30 m so the HMM candidate set stays small.
	const radii = points.map((_, i) =>
		i === 0 || i === points.length - 1 ? MATCH_RADIUS_WAYPOINT_METERS : MATCH_RADIUS_METERS
	);
	const params = new URLSearchParams({
		overview: 'full',
		geometries: 'polyline',
		steps: 'false',
		tidy: 'true',
		radiuses: radii.join(';'),
		waypoints: `0;${points.length - 1}`
	});
	const url = `${OSRM_BASE_URL}/match/v1/${OSRM_PROFILE}/${coords}?${params.toString()}`;

	const response = await fetch(url, { headers: { Accept: 'application/json' } });
	const body = (await readOsrmJson(response)) as OsrmMatchResponse;
	if (!response.ok) throw osrmApiError('match', response, body);
	if (body.code !== 'Ok') {
		throw osrmApiError('match', response, body);
	}

	const order = matchingIndexesInTraceOrder(body.tracepoints ?? [], body.matchings.length);
	const matchings = order
		.map((index) => body.matchings[index])
		.filter((matching) => matching?.geometry);
	if (matchings.length === 0) {
		throw new Error('OSRM returned no match.');
	}

	const totalConfidence = matchings.reduce((sum, matching) => sum + matching.confidence, 0);
	const avgConfidence = totalConfidence / matchings.length;

	return {
		geometries: matchings.map((matching) => matching.geometry),
		distance: matchings.reduce((sum, matching) => sum + matching.distance, 0),
		duration: matchings.reduce((sum, matching) => sum + matching.duration, 0),
		confidence: avgConfidence,
		chunkOutcomes: [{ kind: 'matched', confidence: avgConfidence }]
	};
}

async function getSparseRouteAsMatchResult(
	points: Point[],
	code: 'NoMatch' | 'Detour'
): Promise<MatchResult> {
	const anchors = sparseFallbackAnchors(points);
	const route = await getRoute(anchors);
	return {
		geometries: [route.geometry],
		distance: route.distance,
		duration: route.duration,
		confidence: 1,
		chunkOutcomes: [{ kind: 'fallback', code }]
	};
}

async function readOsrmJson(response: Response): Promise<OsrmBaseResponse> {
	try {
		return (await response.json()) as OsrmBaseResponse;
	} catch {
		return {
			code: response.ok ? 'Ok' : 'HttpError',
			message: `${response.status} ${response.statusText}`
		};
	}
}

function osrmApiError(
	service: 'match' | 'route',
	response: Response,
	body: OsrmBaseResponse
): OsrmApiError {
	const code = body.code || 'HttpError';
	const message = body.message || `${response.status} ${response.statusText}`;
	return new OsrmApiError(service, code, `OSRM returned ${service} error: ${code} — ${message}`);
}

class OsrmApiError extends Error {
	constructor(
		readonly service: 'match' | 'route',
		readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'OsrmApiError';
	}
}

type OsrmBaseResponse = {
	code: string;
	message?: string;
};

type OsrmRouteResponse = {
	code: string;
	message?: string;
	routes: Array<{
		geometry: string;
		distance: number;
		duration: number;
	}>;
};

type OsrmMatchTracepoint = {
	matchings_index: number;
	waypoint_index: number;
	alternatives_count: number;
};

type OsrmMatchResponse = {
	code: string;
	message?: string;
	tracepoints?: Array<OsrmMatchTracepoint | null>;
	matchings: Array<{
		geometry: string;
		distance: number;
		duration: number;
		confidence: number;
	}>;
};

type OsrmTableResponse = {
	code: string;
	message?: string;
	// null when OSRM cannot route between a pair
	distances?: Array<Array<number | null>>;
};
