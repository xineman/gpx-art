import type { ValhallaConfig } from './types.server';

export type ValhallaEndpoint = 'trace_attributes' | 'route' | 'sources_to_targets';

/** Error fields Valhalla may include in any JSON response. */
type ValhallaErrorFields = {
	error?: string;
	error_code?: number;
	status_code?: number;
};

/**
 * One Valhalla POST, classified once for every adapter. `status` is the provider status to report
 * upstream: Valhalla's own `status_code` when present, the HTTP status for non-2xx responses, or
 * 502 when the server could not be reached or returned an unusable 2xx body.
 */
export type ValhallaReply<T> =
	| { ok: true; body: T }
	| { ok: false; reason: 'unreachable'; status: number }
	| { ok: false; reason: 'unreadable'; status: number; httpStatus: number; httpOk: boolean }
	| {
			ok: false;
			reason: 'rejected';
			status: number;
			httpStatus: number;
			/** Trimmed provider error message; empty when Valhalla sent none. */
			message: string;
			errorCode: number | null;
	  };

export type ValhallaFailureReply = Extract<ValhallaReply<unknown>, { ok: false }>;

/** Provider status for an unreachable server or an unusable successful response. */
export const PROVIDER_UNAVAILABLE_STATUS = 502;

function finiteOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function valhallaUrl(baseUrl: string, endpoint: ValhallaEndpoint): string {
	return `${baseUrl.replace(/\/+$/, '')}/${endpoint}`;
}

/** POST a JSON body to one Valhalla endpoint and classify the reply. */
export async function postValhalla<T extends object>(
	config: ValhallaConfig,
	endpoint: ValhallaEndpoint,
	body: unknown
): Promise<ValhallaReply<T>> {
	const fetchFn = config.fetchFn ?? fetch;
	let response: Response;
	try {
		response = await fetchFn(valhallaUrl(config.baseUrl, endpoint), {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': config.userAgent
			},
			body: JSON.stringify(body)
		});
	} catch {
		return { ok: false, reason: 'unreachable', status: PROVIDER_UNAVAILABLE_STATUS };
	}

	const httpStatus = response.status;
	let parsed: (T & ValhallaErrorFields) | null = null;
	try {
		const json: unknown = await response.json();
		if (typeof json === 'object' && json !== null) parsed = json as T & ValhallaErrorFields;
	} catch {
		// Classified as unreadable below.
	}

	if (!parsed) {
		return {
			ok: false,
			reason: 'unreadable',
			status: response.ok ? PROVIDER_UNAVAILABLE_STATUS : httpStatus,
			httpStatus,
			httpOk: response.ok
		};
	}

	if (!response.ok || parsed.error) {
		return {
			ok: false,
			reason: 'rejected',
			status: response.ok
				? (finiteOrNull(parsed.status_code) ?? PROVIDER_UNAVAILABLE_STATUS)
				: httpStatus,
			httpStatus,
			message: typeof parsed.error === 'string' ? parsed.error.trim() : '',
			errorCode: finiteOrNull(parsed.error_code)
		};
	}

	return { ok: true, body: parsed };
}
