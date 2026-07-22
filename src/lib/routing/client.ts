import type { RouteRequest, RouteResponse } from './types';

/**
 * Browser client for the app's route API (proxies Valhalla server-side).
 * Vias must already be prepared on the client (`featuresToVias`).
 */
export async function requestRoute(request: RouteRequest): Promise<RouteResponse> {
	let response: Response;
	try {
		response = await fetch('/api/route', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify(request)
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
		const failure = parsed as { error: string; status?: unknown };
		return {
			ok: false,
			error: failure.error,
			...(typeof failure.status === 'number' ? { status: failure.status } : {})
		};
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
