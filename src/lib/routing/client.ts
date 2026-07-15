import type { Position } from 'geojson';
import type { RouteLeg } from './prepare';
import type { RouteResponse } from './types';

export type RouteRequestBody = {
	legs: Array<{ vias: Position[]; closed?: boolean }>;
};

/**
 * Browser client for the app's route API (proxies OSRM server-side).
 * Legs must already be prepared on the client (`prepareRouteLegs`).
 */
export async function requestRoute(legs: RouteLeg[]): Promise<RouteResponse> {
	const body: RouteRequestBody = {
		legs: legs.map((leg) => ({ vias: leg.vias, closed: leg.closed }))
	};

	let response: Response;
	try {
		response = await fetch('/api/route', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify(body)
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
