import type { LineString } from 'geojson';
import { parseApiFailure, postJson } from '../shared/http-client';
import type { RouteAttributionResponse } from './types';

/** Attribute an accepted route geometry for the road ribbon and map inspection. */
export async function requestRouteAttributes(
	geometry: LineString
): Promise<RouteAttributionResponse> {
	const parsed = await postJson(
		'/api/attributes',
		{ geometry },
		'Network error — couldn’t load road details.'
	);
	const failure = parseApiFailure(parsed);
	if (failure) return failure;
	if (
		typeof parsed === 'object' &&
		parsed !== null &&
		'ok' in parsed &&
		(parsed as { ok: unknown }).ok === true &&
		'roadSpans' in parsed &&
		Array.isArray((parsed as { roadSpans: unknown }).roadSpans)
	) {
		return parsed as RouteAttributionResponse;
	}
	return { ok: false, error: 'Road details response was unexpected.' };
}
