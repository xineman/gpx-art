import { ROUTE_DEBUG_PALETTE } from '$lib/constants/routing';
import type { Point, Shape, ShapeType } from '$lib/types/sketch';

// One entry in the OSRM batch debug overlay — the points forwarded to a
// single /route call for one shape (or one structured edge's via list).
export interface RouteDebugBatch {
	// 0-based index of the shape in the TSP-solved visit order, NOT the
	// original shape array. Stable across calls with the same shape order.
	shapeIndex: number;
	shapeType: ShapeType;
	// Always /route now; kept for overlay label stability.
	callKind: 'route';
	// 0-based batch index within the shape. Always 0 today (one batch per
	// shape in the plan; multi-edge structured still collapses to the corner
	// list for debug display).
	chunkIndex: number;
	chunkCount: number;
	// Color from ROUTE_DEBUG_PALETTE (modulo).
	color: string;
	// Coordinates forwarded to this OSRM call.
	points: Point[];
	// Inclusive start index into the per-shape processed point list.
	startIndex: number;
	// Exclusive end index.
	endIndex: number;
}

// Build the per-call debug plan from the TSP-ordered shapes and the points
// each shape actually forwarded to OSRM.
//
// `orderedShapes` and `processedPoints` must be aligned.
// Color assignment is per-batch. Returns an empty array when nothing is routable.
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
			continue;
		}

		const currentShapeIndex = shapeIndex;
		shapeIndex++;

		batches.push({
			shapeIndex: currentShapeIndex,
			shapeType: shape.type,
			callKind: 'route',
			chunkIndex: 0,
			chunkCount: 1,
			color: ROUTE_DEBUG_PALETTE[batchIndex % ROUTE_DEBUG_PALETTE.length],
			points: [...points],
			startIndex: 0,
			endIndex: points.length
		});
		batchIndex++;
	}

	return batches;
}
