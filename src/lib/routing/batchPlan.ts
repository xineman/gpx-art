import { MATCH_DEBUG_PALETTE } from '$lib/constants/routing';
import type { Point, Shape, ShapeType } from '$lib/types/sketch';
import { chunkPointsForMatch, type ChunkOutcome } from './osrm';

export type RouteCallKind = 'match' | 'route';

// One entry in the /match batch debug overlay. Represents a contiguous slice
// of points that the routing pipeline would forward to a single OSRM call —
// either one chunk of a chunked /match or the full point list for /route.
export interface RouteDebugBatch {
	// 0-based index of the shape in the TSP-solved visit order, NOT the
	// original shape array. Stable across calls with the same shape order.
	shapeIndex: number;
	shapeType: ShapeType;
	// 'match' for chunked soft traces; 'route' for hard-via shapes.
	callKind: 'match' | 'route';
	// 0-based chunk index within the shape. Always 0 for /route shapes
	// (no chunking) — chunkCount is 1 in that case.
	chunkIndex: number;
	// Total number of chunks for this shape. Equals 1 for /route shapes.
	chunkCount: number;
	// Color from MATCH_DEBUG_PALETTE (modulo). Adjacent chunks get different
	// colors so the overlay distinguishes them at a glance.
	color: string;
	// Coordinates forwarded to this OSRM call (chunk slice or full list).
	points: Point[];
	// Inclusive start index into the per-shape processed point list.
	startIndex: number;
	// Exclusive end index.
	endIndex: number;
	// Outcome of the actual OSRM call for this batch. Undefined for pure
	// /route shapes and for plans built before calls complete. Populated by
	// attachOutcomes once getMatchedRoute returns.
	outcome?: ChunkOutcome;
}

// Whether createRoute / prepareShapeRoute should send this shape through the
// pencil pipeline (getMatchedRoute: sparse /route first, /match only if fit
// is poor). Structured shapes always use hard /route (optionally adaptive
// per-edge) and never enter that ladder.
export function usesMatchApi(shapeType: ShapeType): boolean {
	return shapeType === 'pencil';
}

// Build the per-call debug plan from the TSP-ordered shapes and the points
// each shape would actually forward to OSRM.
//
// `orderedShapes`, `processedPoints`, and `callKinds` must be aligned:
// processedPoints[i] / callKinds[i] describe orderedShapes[i]. callKinds come
// from prepareShapeRoute so debug matches the live API decision.
//
// Color assignment is per-batch (not per-shape) so adjacent chunks read as
// different colors. Returns an empty array when nothing is routable.
export function buildRoutePlan(
	orderedShapes: Shape[],
	processedPoints: Point[][],
	callKinds: RouteCallKind[]
): RouteDebugBatch[] {
	const batches: RouteDebugBatch[] = [];
	let batchIndex = 0;
	let shapeIndex = 0;

	for (let i = 0; i < orderedShapes.length; i++) {
		const shape = orderedShapes[i];
		const points = processedPoints[i] ?? [];
		const callKind = callKinds[i] ?? 'route';

		if (points.length < 2) {
			continue;
		}

		const currentShapeIndex = shapeIndex;
		shapeIndex++;

		if (callKind === 'match') {
			const chunks = chunkPointsForMatch(points);
			chunks.forEach((chunk, chunkIndex) => {
				const startIndex = points.indexOf(chunk[0]);
				batches.push({
					shapeIndex: currentShapeIndex,
					shapeType: shape.type,
					callKind: 'match',
					chunkIndex,
					chunkCount: chunks.length,
					color: MATCH_DEBUG_PALETTE[batchIndex % MATCH_DEBUG_PALETTE.length],
					points: chunk,
					startIndex,
					endIndex: startIndex + chunk.length
				});
				batchIndex++;
			});
		} else {
			batches.push({
				shapeIndex: currentShapeIndex,
				shapeType: shape.type,
				callKind: 'route',
				chunkIndex: 0,
				chunkCount: 1,
				color: MATCH_DEBUG_PALETTE[batchIndex % MATCH_DEBUG_PALETTE.length],
				points: [...points],
				startIndex: 0,
				endIndex: points.length
			});
			batchIndex++;
		}
	}

	return batches;
}

// Attach per-chunk outcomes to the batches produced by buildRoutePlan.
//
// `chunkOutcomesByShape` is aligned with the same TSP-solved order the plan
// was built from. Undefined entries mean the shape used pure /route (no
// match fallback ladder). Returns a new array; the input plan is not mutated.
export function attachOutcomes(
	plan: readonly RouteDebugBatch[],
	chunkOutcomesByShape: ReadonlyArray<readonly ChunkOutcome[] | undefined>
): RouteDebugBatch[] {
	return plan.map((batch) => {
		const shapeOutcomes = chunkOutcomesByShape[batch.shapeIndex];
		const outcome = shapeOutcomes?.[batch.chunkIndex];
		return outcome ? { ...batch, outcome } : batch;
	});
}
