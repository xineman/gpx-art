import {
	MATCH_CHUNK_OVERLAP,
	MATCH_CONFIDENCE_THRESHOLD,
	MATCH_MAX_POINTS,
	MATCH_RADIUS_METERS,
	MATCH_RADIUS_WAYPOINT_METERS,
	OSRM_BASE_URL,
	OSRM_PROFILE
} from '$lib/constants/routing';
import type { Point } from '$lib/types/sketch';

export type RouteResult = {
	geometry: string;
	distance: number;
	duration: number;
};

// Per-chunk outcome for a /match call: either the match was used as-is
// (with the avg confidence across its confident matchings) or the pipeline
// fell through to /route because /match returned NoMatch (a waypoint
// couldn't snap inside its radius) or LowConfidence (matchings existed but
// the HMM was below MATCH_CONFIDENCE_THRESHOLD). Surfaced via the batch
// debug legend so the user can see which chunks needed the fallback and why.
//
// `code` keeps OSRM's exact reason string for the legend (e.g. "NoMatch").
// `reason` is a stable discriminator for code-based UI logic; new OSRM codes
// would need an explicit mapping here to keep the discriminator exhaustive.
export type ChunkOutcome =
	| { kind: 'matched'; confidence: number }
	| {
			kind: 'fallback';
			reason: 'no_match' | 'low_confidence';
			code: 'NoMatch' | 'LowConfidence';
	  };

export type MatchResult = {
	geometries: string[];
	distance: number;
	duration: number;
	confidence: number;
	// One entry per chunk dispatched, in dispatch order. For chunk-level
	// callers (getMatchChunk, getBestRouteForChunk, getRouteAsMatchResult)
	// this is always a single-element array; getMatchedRoute concatenates
	// them into the final per-shape list.
	chunkOutcomes: ChunkOutcome[];
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

// Map-match a hand-drawn trace to the road network.
//
// OSRM /match is better suited than /route for dense sketch points because it
// treats the input as a noisy trace and can drop outliers (`tracepoints: null`)
// instead of forcing the route through every anchor. The public demo endpoint
// allows only small traces, so split longer shapes into overlapping chunks.
//
// Chunks are dispatched in parallel. The chunks are independent once split,
// and a complex Warsaw pencil stroke produces 5–6 chunks that each take
// ~20–30 s — sequential would be 100–150 s, parallel is the max. Local
// `osrm-routed` is multi-threaded by default, so 5–6 simultaneous requests
// are fine. Promise.all preserves fail-fast semantics (one chunk's hard
// error aborts createRoute) matching the previous sequential behaviour.
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
		// Each chunk-level MatchResult has exactly one ChunkOutcome describing
		// that chunk's dispatch outcome. Concatenate in dispatch order so the
		// returned list aligns with `chunks`.
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
		return await getMatchChunk(points);
	} catch (err) {
		// NoMatch (whole chunk rejected because a waypoint couldn't snap) and
		// LowConfidence (chunk matched but HMM was too uncertain to trust)
		// both fall through to /route with the full chunk points (not just
		// endpoints), so the route still follows the shape's trajectory.
		// The error code is captured into the chunk outcome so the batch
		// debug legend can surface per-chunk why the fallback was needed.
		if (err instanceof OsrmApiError && (err.code === 'NoMatch' || err.code === 'LowConfidence')) {
			const reason = err.code === 'NoMatch' ? 'no_match' : 'low_confidence';
			return getRouteAsMatchResult(points, reason, err.code);
		}
		throw err;
	}
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

	// /match can succeed with confidence close to 0 when most tracepoints
	// were dropped or when a waypoint was snapped far outside the typical
	// road network (e.g. anchor 200+ m from any road but accepted by the
	// relaxed waypoint radius). The resulting geometry is visually no
	// better than the /route fallback and adds latency. Treat sub-threshold
	// matchings as no result so getBestRouteForChunk falls through to /route.
	const confident = matchings.filter(
		(matching) => matching.confidence >= MATCH_CONFIDENCE_THRESHOLD
	);
	if (confident.length === 0) {
		throw new OsrmApiError(
			'match',
			'LowConfidence',
			`OSRM match confidence below ${MATCH_CONFIDENCE_THRESHOLD} for chunk — falling back to /route`
		);
	}

	return {
		geometries: confident.map((matching) => matching.geometry),
		distance: confident.reduce((sum, matching) => sum + matching.distance, 0),
		duration: confident.reduce((sum, matching) => sum + matching.duration, 0),
		confidence:
			confident.reduce((sum, matching) => sum + matching.confidence, 0) / confident.length,
		chunkOutcomes: [
			{
				kind: 'matched',
				confidence:
					confident.reduce((sum, matching) => sum + matching.confidence, 0) / confident.length
			}
		]
	};
}

async function getRouteAsMatchResult(
	points: Point[],
	reason: 'no_match' | 'low_confidence',
	code: 'NoMatch' | 'LowConfidence'
): Promise<MatchResult> {
	const route = await getRoute(points);
	return {
		geometries: [route.geometry],
		distance: route.distance,
		duration: route.duration,
		confidence: 1,
		chunkOutcomes: [{ kind: 'fallback', reason, code }]
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
