import type { LineString, Position } from 'geojson';
import type { OsrmRouteResponse } from './types';

export type OsrmFetchResult =
	| { ok: true; geometry: LineString; distanceM: number }
	| { ok: false; error: string; status?: number };

export type OsrmConfig = {
	baseUrl: string;
	/** Path profile segment, e.g. `driving` on FOSSGIS routed-bike. */
	profile: string;
	userAgent: string;
	/** Optional inject for tests. */
	fetchFn?: typeof fetch;
};

function trimTrailingSlash(url: string) {
	return url.replace(/\/+$/, '');
}

/**
 * Build OSRM Route URL.
 * FOSSGIS bike: base `…/routed-bike`, profile often `driving` (graph is bike).
 */
export function buildOsrmRouteUrl(baseUrl: string, profile: string, vias: Position[]): string {
	const coords = vias.map((p) => `${p[0]},${p[1]}`).join(';');
	const base = trimTrailingSlash(baseUrl);
	const params = new URLSearchParams({
		overview: 'full',
		geometries: 'geojson',
		steps: 'false',
		annotations: 'false'
	});
	return `${base}/route/v1/${encodeURIComponent(profile)}/${coords}?${params}`;
}

export async function fetchOsrmRoute(
	vias: Position[],
	config: OsrmConfig
): Promise<OsrmFetchResult> {
	if (vias.length < 2) {
		return { ok: false, error: 'Need a longer sketch to route.' };
	}

	const url = buildOsrmRouteUrl(config.baseUrl, config.profile, vias);
	const fetchFn = config.fetchFn ?? fetch;

	let response: Response;
	try {
		response = await fetchFn(url, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				'User-Agent': config.userAgent
			}
		});
	} catch {
		return { ok: false, error: 'Couldn’t reach the routing server.' };
	}

	if (!response.ok) {
		return {
			ok: false,
			error: `Routing server error (${response.status}).`,
			status: response.status
		};
	}

	let body: OsrmRouteResponse;
	try {
		body = (await response.json()) as OsrmRouteResponse;
	} catch {
		return { ok: false, error: 'Routing server returned invalid JSON.' };
	}

	if (body.code !== 'Ok') {
		const msg =
			body.code === 'NoRoute'
				? 'No bike route found near that sketch — try closer to roads.'
				: body.message?.trim() || `Routing failed (${body.code}).`;
		return { ok: false, error: msg };
	}

	const route = body.routes?.[0];
	const geometry = route?.geometry;
	if (!geometry || typeof geometry === 'string' || geometry.type !== 'LineString') {
		return { ok: false, error: 'Routing server returned no geometry.' };
	}
	if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
		return { ok: false, error: 'Routing server returned an empty path.' };
	}

	return {
		ok: true,
		geometry,
		distanceM: typeof route?.distance === 'number' ? route.distance : 0
	};
}
