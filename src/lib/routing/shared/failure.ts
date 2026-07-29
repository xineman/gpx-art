export type RouteFailure = {
	ok: false;
	error: string;
	/** HTTP status associated with the failure, when available. */
	status?: number;
};
