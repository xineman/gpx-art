import type { Position } from 'geojson';
import type { RouteResponse } from './types';

/**
 * Browser client for the app's route API (proxies OSRM server-side).
 * Vias must already be prepared on the client (`prepareRouteVias`).
 */
export async function requestRoute(vias: Position[]): Promise<RouteResponse> {
	let response: Response;
	try {
		response = await fetch('/api/route', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify({ vias })
		});
	} catch {
		return { ok: false, error: 'Network error — couldn’t start routing.' };
	}

	let parsed: unknown;
	try {
		parsed = await response.json();
	} catch {
		return { ok: false, error: 'Routing response was unreadable.' };
	}

	if (
		typeof parsed === 'object' &&
		parsed !== null &&
		'ok' in parsed &&
		(parsed as { ok: unknown }).ok === false &&
		'error' in parsed &&
		typeof (parsed as { error: unknown }).error === 'string'
	) {
		return { ok: false, error: (parsed as { error: string }).error };
	}

	if (
		typeof parsed === 'object' &&
		parsed !== null &&
		'ok' in parsed &&
		(parsed as { ok: unknown }).ok === true
	) {
		return parsed as RouteResponse;
	}

	if (!response.ok) {
		return { ok: false, error: `Routing failed (${response.status}).` };
	}

	return { ok: false, error: 'Routing response was unexpected.' };
}
