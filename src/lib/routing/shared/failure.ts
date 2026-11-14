import type { ApiFailure } from './api-response';

export type RouteFailureCode = 'superseded';

export type RouteFailure = ApiFailure & {
	/** Machine-readable reason for failures handled specially by the client. */
	code?: RouteFailureCode;
};

export function supersededFailure(): RouteFailure {
	return { ok: false, code: 'superseded', error: 'Superseded.' };
}

export function isSupersededFailure(failure: RouteFailure): boolean {
	return failure.code === 'superseded';
}
