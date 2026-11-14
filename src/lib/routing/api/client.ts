import type { LineString, Position } from 'geojson';
import type {
	MatrixRequest,
	MatrixResponse,
	RouteAttributionResponse,
	RouteFailure,
	RouteRequest,
	RouteResponse
} from './contracts';
import { supersededFailure } from './failure';

export type RoutingRequestOptions = {
	signal?: AbortSignal;
};

export async function postJson(
	path: string,
	body: unknown,
	networkError: string,
	options: RoutingRequestOptions = {}
): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(path, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify(body),
			signal: options.signal
		});
	} catch {
		if (options.signal?.aborted) return supersededFailure();
		return { ok: false, error: networkError };
	}

	try {
		return await response.json();
	} catch {
		if (options.signal?.aborted) return supersededFailure();
		return { ok: false, error: 'Routing response was unreadable.' };
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function parseApiFailure(value: unknown): RouteFailure | null {
	if (!isRecord(value) || value.ok !== false || typeof value.error !== 'string') return null;

	return {
		ok: false,
		error: value.error,
		...(value.code === 'superseded' ? { code: 'superseded' as const } : {}),
		...(typeof value.status === 'number' ? { status: value.status } : {})
	};
}

type RoutingApiCall = {
	path: string;
	networkError: string;
	unexpectedError: string;
	/** Fields a success payload must carry as arrays. */
	requiredArrays: readonly string[];
};

/**
 * POST to one routing endpoint and return its success payload or a structured failure. Success
 * payloads get a light shape check; the server validates them fully against the API contracts.
 */
async function postRoutingApi<Success extends { ok: true }>(
	call: RoutingApiCall,
	body: unknown,
	options: RoutingRequestOptions
): Promise<Success | RouteFailure> {
	const parsed = await postJson(call.path, body, call.networkError, options);
	const failure = parseApiFailure(parsed);
	if (failure) return failure;
	if (
		isRecord(parsed) &&
		parsed.ok === true &&
		call.requiredArrays.every((field) => Array.isArray(parsed[field]))
	) {
		return parsed as Success;
	}
	return { ok: false, error: call.unexpectedError };
}

/** Request one ordered Valhalla map-matching trace. */
export function requestRoute(
	request: RouteRequest,
	options: RoutingRequestOptions = {}
): Promise<RouteResponse> {
	return postRoutingApi(
		{
			path: '/api/route',
			networkError: 'Network error — couldn’t start routing.',
			unexpectedError: 'Routing response was unexpected.',
			requiredArrays: ['waypoints']
		},
		request,
		options
	);
}

/** Request bicycle distances between every pair of coordinates. */
export function requestMatrix(
	coordinates: Position[],
	options: RoutingRequestOptions = {}
): Promise<MatrixResponse> {
	const request: MatrixRequest = { coordinates };
	return postRoutingApi(
		{
			path: '/api/matrix',
			networkError: 'Network error — couldn’t load bike distances.',
			unexpectedError: 'Routing response was unexpected.',
			requiredArrays: ['distances']
		},
		request,
		options
	);
}

/** Attribute an accepted route geometry for the road ribbon and map inspection. */
export function requestRouteAttributes(
	geometry: LineString,
	options: RoutingRequestOptions = {}
): Promise<RouteAttributionResponse> {
	return postRoutingApi(
		{
			path: '/api/attributes',
			networkError: 'Network error — couldn’t load road details.',
			unexpectedError: 'Road details response was unexpected.',
			requiredArrays: ['roadEdges', 'roadSpans']
		},
		{ geometry },
		options
	);
}
