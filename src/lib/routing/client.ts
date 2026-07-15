import type { Feature } from 'geojson';
import type { RouteResponse } from './types';

/**
 * Browser client for the app's route API (proxies OSRM server-side).
 */
export async function requestRoute(features: Feature[]): Promise<RouteResponse> {
	let response: Response;
	try {
		response = await fetch('/api/route', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify({ features })
		});
	} catch {
		return { ok: false, error: 'Network error — couldn’t start routing.' };
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return { ok: false, error: 'Routing response was unreadable.' };
	}

	if (
		typeof body === 'object' &&
		body !== null &&
		'ok' in body &&
		(body as { ok: unknown }).ok === false &&
		'error' in body &&
		typeof (body as { error: unknown }).error === 'string'
	) {
		return { ok: false, error: (body as { error: string }).error };
	}

	if (
		typeof body === 'object' &&
		body !== null &&
		'ok' in body &&
		(body as { ok: unknown }).ok === true
	) {
		return body as RouteResponse;
	}

	if (!response.ok) {
		return { ok: false, error: `Routing failed (${response.status}).` };
	}

	return { ok: false, error: 'Routing response was unexpected.' };
}
