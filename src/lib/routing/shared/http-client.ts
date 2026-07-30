import { supersededFailure, type RouteFailure } from './failure';

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

export function parseApiFailure(value: unknown): RouteFailure | null {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('ok' in value) ||
		(value as { ok: unknown }).ok !== false ||
		!('error' in value) ||
		typeof (value as { error: unknown }).error !== 'string'
	) {
		return null;
	}

	const failure = value as { error: string; code?: unknown; status?: unknown };
	return {
		ok: false,
		error: failure.error,
		...(failure.code === 'superseded' ? { code: 'superseded' as const } : {}),
		...(typeof failure.status === 'number' ? { status: failure.status } : {})
	};
}
