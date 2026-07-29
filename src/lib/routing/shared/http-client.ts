import type { RouteFailure } from './failure';

export async function postJson(
	path: string,
	body: unknown,
	networkError: string
): Promise<unknown> {
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

	const failure = value as { error: string; status?: unknown };
	return {
		ok: false,
		error: failure.error,
		...(typeof failure.status === 'number' ? { status: failure.status } : {})
	};
}
