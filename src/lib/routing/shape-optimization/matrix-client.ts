import type { Position } from 'geojson';
import { parseApiFailure, postJson, type RoutingRequestOptions } from '../shared/http-client';
import type { MatrixRequest, MatrixResponse } from './types';

export async function requestMatrix(
	coordinates: Position[],
	options: RoutingRequestOptions = {}
): Promise<MatrixResponse> {
	const request: MatrixRequest = { coordinates };
	const parsed = await postJson(
		'/api/matrix',
		request,
		'Network error — couldn’t load bike distances.',
		options
	);
	const failure = parseApiFailure(parsed);
	if (failure) return failure;
	if (
		typeof parsed === 'object' &&
		parsed !== null &&
		'ok' in parsed &&
		(parsed as { ok: unknown }).ok === true &&
		'distances' in parsed &&
		Array.isArray((parsed as { distances: unknown }).distances)
	) {
		return parsed as MatrixResponse;
	}
	return { ok: false, error: 'Routing response was unexpected.' };
}
