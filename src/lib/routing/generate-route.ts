import type { Position } from 'geojson';
import { requestRoute } from './matching/client';
import type { RouteRequest, RouteResponse } from './matching/types';
import type { PreparedRouteShape } from './preparation/types';
import { buildShapeOptimizationProblem } from './shape-optimization/build-problem';
import { requestMatrix } from './shape-optimization/matrix-client';
import { optimizeShapeTraversal } from './shape-optimization/shape-optimizer';
import type { RoutingRequestOptions } from './shared/http-client';

function requestFromPositions(points: Position[]): RouteRequest {
	return { vias: points.map((location) => ({ location })) };
}

/** Optimize grouped shapes in the browser, then request one ordered route. */
export async function requestOptimizedRoute(
	shapes: PreparedRouteShape[],
	options: RoutingRequestOptions = {}
): Promise<RouteResponse> {
	if (shapes.length === 0) {
		return { ok: false, error: 'No routable shapes in the sketch.' };
	}
	if (shapes.length === 1) {
		return requestRoute(requestFromPositions(shapes[0]!.vias), options);
	}

	const problem = buildShapeOptimizationProblem(shapes);
	const matrix = await requestMatrix(problem.coordinates, options);
	if (!matrix.ok) return matrix;

	const optimized = optimizeShapeTraversal(problem, matrix.distances);
	if (!optimized.ok) return optimized;
	return requestRoute(requestFromPositions(optimized.vias), options);
}
