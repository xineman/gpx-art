function trimTrailingSlash(url: string) {
	return url.replace(/\/+$/, '');
}

export function buildValhallaTraceUrl(baseUrl: string) {
	return `${trimTrailingSlash(baseUrl)}/trace_attributes`;
}

export function buildValhallaRouteUrl(baseUrl: string) {
	return `${trimTrailingSlash(baseUrl)}/route`;
}
