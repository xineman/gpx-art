import type { LineString, Position } from 'geojson';
import type { OsrmRouteResponse, OsrmTableResponse, RouteRequest } from './types';

export type OsrmFetchResult =
	| {
			ok: true;
			geometry: LineString;
			distanceM: number;
			waypoints: Position[];
	  }
	| { ok: false; error: string; status?: number };

export type OsrmTableFetchResult =
	| { ok: true; distances: Array<Array<number | null>> }
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

function isFinitePosition(value: unknown): value is Position {
	return (
		Array.isArray(value) &&
		value.length >= 2 &&
		typeof value[0] === 'number' &&
		typeof value[1] === 'number' &&
		Number.isFinite(value[0]) &&
		Number.isFinite(value[1])
	);
}

/** Build an OSRM Route URL from an already validated request. */
export function buildOsrmRouteUrl(baseUrl: string, profile: string, request: RouteRequest): string {
	const { vias, continueStraight } = request;
	const coords = vias.map(({ location }) => `${location[0]},${location[1]}`).join(';');
	const base = trimTrailingSlash(baseUrl);
	const params = new URLSearchParams({
		overview: 'full',
		geometries: 'geojson',
		steps: 'false',
		annotations: 'false',
		generate_hints: 'false'
	});
	const radiuses = vias.map(({ radiusM }) => (radiusM == null ? '' : String(radiusM))).join(';');
	const bearings = vias
		.map(({ bearing, bearingRange }) => (bearing == null ? '' : `${bearing},${bearingRange ?? 45}`))
		.join(';');
	if (vias.some(({ radiusM }) => radiusM != null)) params.set('radiuses', radiuses);
	if (vias.some(({ bearing }) => bearing != null)) params.set('bearings', bearings);
	if (continueStraight != null) params.set('continue_straight', String(continueStraight));
	return `${base}/route/v1/${encodeURIComponent(profile)}/${coords}?${params}`;
}

/** Build an OSRM Table URL for directed bike-network distances. */
export function buildOsrmTableUrl(
	baseUrl: string,
	profile: string,
	coordinates: Position[]
): string {
	const coords = coordinates.map((location) => `${location[0]},${location[1]}`).join(';');
	const base = trimTrailingSlash(baseUrl);
	const params = new URLSearchParams({
		annotations: 'distance',
		generate_hints: 'false'
	});
	return `${base}/table/v1/${encodeURIComponent(profile)}/${coords}?${params}`;
}

export async function fetchOsrmDistanceTable(
	coordinates: Position[],
	config: OsrmConfig
): Promise<OsrmTableFetchResult> {
	const url = buildOsrmTableUrl(config.baseUrl, config.profile, coordinates);
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
		return {
			ok: false,
			error: 'Couldn’t optimize shape order — couldn’t reach the routing server.'
		};
	}

	if (!response.ok) {
		return {
			ok: false,
			error: `Couldn’t optimize shape order — routing server error (${response.status}).`,
			status: response.status
		};
	}

	let body: OsrmTableResponse;
	try {
		body = (await response.json()) as OsrmTableResponse;
	} catch {
		return { ok: false, error: 'Couldn’t optimize shape order — invalid routing response.' };
	}

	if (body.code !== 'Ok' || !Array.isArray(body.distances)) {
		return {
			ok: false,
			error: 'Couldn’t optimize shape order — no bike-distance table is available.'
		};
	}
	return { ok: true, distances: body.distances };
}

export async function fetchOsrmRoute(
	request: RouteRequest,
	config: OsrmConfig
): Promise<OsrmFetchResult> {
	const { vias } = request;
	if (vias.length < 2) {
		return { ok: false, error: 'Need a longer sketch to route.' };
	}

	const url = buildOsrmRouteUrl(config.baseUrl, config.profile, request);
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
	const snappedWaypoints = body.waypoints?.map((waypoint) => waypoint.location) ?? [];
	const waypoints =
		snappedWaypoints.length === vias.length && snappedWaypoints.every(isFinitePosition)
			? snappedWaypoints
			: vias.map(({ location }) => location);

	return {
		ok: true,
		geometry,
		distanceM: typeof route?.distance === 'number' ? route.distance : 0,
		waypoints
	};
}
