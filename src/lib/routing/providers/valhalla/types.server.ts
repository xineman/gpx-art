export type ValhallaConfig = {
	baseUrl: string;
	userAgent: string;
	/** Optional inject for tests. */
	fetchFn?: typeof fetch;
};
