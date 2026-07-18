import type { Position } from 'geojson';
import { buildShapeOptimizationProblem } from './optimization-problem';
import { optimizeShapeOrder } from './optimize';
import type {
	PreparedRouteShape,
	RouteRequest,
	RouteResponse,
	TableRequest,
	TableResponse
} from './types';

async function postJson(path: string, body: unknown, networkError: string): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(path, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify(body)
		});
	} catch {
		return { ok: false, error: networkError };
	}

	try {
		return await response.json();
	} catch {
		return { ok: false, error: 'Routing response was unreadable.' };
	}
}

function apiFailure(value: unknown): { ok: false; error: string } | null {
	if (
		typeof value === 'object' &&
		value !== null &&
		'ok' in value &&
		(value as { ok: unknown }).ok === false &&
		'error' in value &&
		typeof (value as { error: unknown }).error === 'string'
	) {
		return { ok: false, error: (value as { error: string }).error };
	}
	return null;
}

export async function requestRoute(request: RouteRequest): Promise<RouteResponse> {
	const parsed = await postJson('/api/route', request, 'Network error — couldn’t start routing.');
	const failure = apiFailure(parsed);
	if (failure) return failure;
	if (
		typeof parsed === 'object' &&
		parsed !== null &&
		'ok' in parsed &&
		(parsed as { ok: unknown }).ok === true
	) {
		return parsed as RouteResponse;
	}
	return { ok: false, error: 'Routing response was unexpected.' };
}

export async function requestTable(coordinates: Position[]): Promise<TableResponse> {
	const request: TableRequest = { coordinates };
	const parsed = await postJson(
		'/api/table',
		request,
		'Network error — couldn’t load bike distances.'
	);
	const failure = apiFailure(parsed);
	if (failure) return failure;
	if (
		typeof parsed === 'object' &&
		parsed !== null &&
		'ok' in parsed &&
		(parsed as { ok: unknown }).ok === true &&
		'distances' in parsed &&
		Array.isArray((parsed as { distances: unknown }).distances)
	) {
		return parsed as TableResponse;
	}
	return { ok: false, error: 'Routing response was unexpected.' };
}

function requestFromPositions(points: Position[]): RouteRequest {
	return { vias: points.map((location) => ({ location })) };
}

/** Optimize grouped shapes in the browser, then request one ordered route. */
export async function requestOptimizedRoute(shapes: PreparedRouteShape[]): Promise<RouteResponse> {
	if (shapes.length === 0) {
		return { ok: false, error: 'No routable shapes in the sketch.' };
	}
	if (shapes.length === 1) {
		return requestRoute(requestFromPositions(shapes[0]!.vias));
	}

	const problem = buildShapeOptimizationProblem(shapes);
	const table = await requestTable(problem.coordinates);
	if (!table.ok) return table;

	const optimized = optimizeShapeOrder(problem, table.distances);
	if (!optimized.ok) return optimized;
	return requestRoute(requestFromPositions(optimized.vias));
}
