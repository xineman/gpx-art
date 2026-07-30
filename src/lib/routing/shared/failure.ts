export type RouteFailureCode = 'superseded';

export type RouteFailure = {
	ok: false;
	error: string;
	/** Machine-readable reason for failures handled specially by the client. */
	code?: RouteFailureCode;
	/** HTTP status associated with the failure, when available. */
	status?: number;
};

export function supersededFailure(): RouteFailure {
	return { ok: false, code: 'superseded', error: 'Superseded.' };
}

export function isSupersededFailure(failure: RouteFailure): boolean {
	return failure.code === 'superseded';
}
