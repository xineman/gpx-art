import type { RouteFailure } from './contracts';

export function supersededFailure(): RouteFailure {
	return { ok: false, code: 'superseded', error: 'Superseded.' };
}

export function isSupersededFailure(failure: RouteFailure): boolean {
	return failure.code === 'superseded';
}
