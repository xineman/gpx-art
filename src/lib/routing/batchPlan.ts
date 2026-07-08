import { chunkPointsForMatch, type ChunkOutcome } from './osrm';
import { MATCH_DEBUG_PALETTE } from '$lib/constants/routing';
import type { Point, Shape, ShapeType } from '$lib/types/sketch';

// One entry in the /match batch debug overlay. Represents a contiguous slice
// of points that the routing pipeline would forward to a single OSRM call —
// either one chunk of a chunked /match (pencil shapes) or the full point list
// for a single /route (structured shapes).
export interface RouteDebugBatch {
	// 0-based index of the shape in the TSP-solved visit order, NOT the
	// original shape array. Stable across calls with the same shape order.
	shapeIndex: number;
	shapeType: ShapeType;
	// 'match' for pencil shapes (chunked + tracepoint radii) and 'route' for
	// structured shapes (no chunking — sent to /route as a single call).
	callKind: 'match' | 'route';
	// 0-based chunk index within the shape. Always 0 for non-pencil shapes
	// (no chunking) — chunkCount is 1 in that case.
	chunkIndex: number;
	// Total number of chunks for this shape. Equals 1 for non-pencil shapes.
	chunkCount: number;
	// Color from MATCH_DEBUG_PALETTE (modulo). Same hue for every chunk in
	// one shape so the user can see at a glance which chunks belong to the
	// same shape's call sequence.
	color: string;
	// The actual coordinates that would go into this OSRM call. For pencil
	// shapes this is the chunk slice (including overlap points shared with
	// the previous/next chunk). For structured shapes it's the full point
	// list passed to /route.
	points: Point[];
	// Inclusive start index into the per-shape processed point list. Useful
	// for the legend so the user can verify overlap arithmetic across
	// chunks (chunk N+1's startIndex is exactly chunkCount - 1 below chunk
	// N's endIndex when overlap > 0).
	startIndex: number;
	// Exclusive end index. startIndex/endIndex are 0..N for a shape whose
	// sample+rdp produced N points.
	endIndex: number;
	// Outcome of the actual OSRM call for this batch. Undefined for the
	// `route` callKind (structured shapes never fall back) and for any
	// batch whose /match call hadn't been issued yet at the time the panel
	// reads it (e.g. when the plan is shown before completion). Populated
	// post-hoc by attachOutcomes once getMatchedRoute has returned its
	// per-chunk outcome list.
	outcome?: ChunkOutcome;
}

// Build the per-call debug plan from the TSP-ordered shapes and the points
// each shape would actually forward to OSRM.
//
// `orderedShapes` and `processedPoints` must be aligned: processedPoints[i]
// is the sample+rdp'd point list for orderedShapes[i]. These are the SAME
// points the createRoute() pipeline hands to getMatchedRoute (pencil) or
// getRoute (structured) — capturing them here guarantees the visualized
// points are exactly what the API receives.
//
// Color assignment is per-batch (not per-shape) so that adjacent chunks of
// the same pencil shape read as different colors — that is the whole point
// of the overlay. The palette cycles by emit order: batch 0 gets slot 0,
// batch 1 gets slot 1, etc. The legend labels each row with its shape and
// chunk index, so palette repeats past slot 7 are still disambiguated.
//
// Returns an empty array when `processedPoints` is empty or contains only
// empty point lists. Each batch is independent and can be rendered in
// isolation.
export function buildRoutePlan(
	orderedShapes: Shape[],
	processedPoints: Point[][]
): RouteDebugBatch[] {
	const batches: RouteDebugBatch[] = [];
	let batchIndex = 0;
	let shapeIndex = 0;

	for (let i = 0; i < orderedShapes.length; i++) {
		const shape = orderedShapes[i];
		const points = processedPoints[i] ?? [];

		if (points.length < 2) {
			// Skip shapes that collapsed to fewer than 2 points after
			// sample+RDP — they cannot be routed. The pipeline's existing
			// degenerate fallback would also skip these.
			continue;
		}

		const isPencil = shape.type === 'pencil';
		const currentShapeIndex = shapeIndex;
		shapeIndex++;

		if (isPencil) {
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
// was built from: chunkOutcomesByShape[i] is the per-chunk outcome list
// returned by getMatchedRoute for the i-th TSP-ordered shape (in chunk
// dispatch order). Undefined entries mean the shape didn't dispatch /match
// calls — typically non-pencil shapes, which go through /route and have no
// fallback path. Structured-shape batches are returned with `outcome`
// still unset so the legend keeps showing the blue `route` pill.
//
// Returns a new array; the input `plan` is never mutated so callers that
// want to keep the original around (e.g. for a future diff view) can.
// Defensive: a short outcomes array leaves later batches with no outcome
// rather than throwing — that lets the legend fall back to its existing
// pre-outcome render for any partially-built plan.
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
