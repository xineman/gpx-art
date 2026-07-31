import { parseApiFailure, postJson, type RoutingRequestOptions } from '../shared/http-client';
import type { RouteRequest, RouteResponse } from './types';

/** Request one ordered Valhalla map-matching trace. */
export async function requestRoute(
	request: RouteRequest,
	options: RoutingRequestOptions = {}
): Promise<RouteResponse> {
	const parsed = await postJson(
		'/api/route',
		request,
		'Network error — couldn’t start routing.',
		options
	);
	const failure = parseApiFailure(parsed);
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
