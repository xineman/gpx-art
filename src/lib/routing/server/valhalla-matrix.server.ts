import type { Position } from 'geojson';
import type { TableResponse } from '../types';
import type { ValhallaConfig } from '../valhalla';

type ValhallaMatrixResponse = {
	error?: string;
	error_code?: number;
	status_code?: number;
	sources_to_targets?: {
		distances?: unknown;
	};
};

function trimTrailingSlash(url: string) {
	return url.replace(/\/+$/, '');
}

export function buildValhallaMatrixUrl(baseUrl: string) {
	return `${trimTrailingSlash(baseUrl)}/sources_to_targets`;
}

/** Build a directed bicycle-distance matrix request for the optimizer's candidate endpoints. */
export function buildValhallaMatrixBody(coordinates: Position[]) {
	const locations = coordinates.map(([lon, lat]) => ({ lat, lon }));
	return {
		sources: locations,
		targets: locations,
		costing: 'bicycle',
		units: 'kilometers',
		verbose: false
	};
}

function normalizeDistances(value: unknown, size: number): (number | null)[][] | null {
	if (!Array.isArray(value) || value.length !== size) return null;

	const distances: (number | null)[][] = [];
	for (const rawRow of value) {
		if (!Array.isArray(rawRow) || rawRow.length !== size) return null;
		const row: (number | null)[] = [];
		for (const rawDistance of rawRow) {
			if (rawDistance === null) {
				row.push(null);
			} else if (
				typeof rawDistance === 'number' &&
				Number.isFinite(rawDistance) &&
				rawDistance >= 0
			) {
				row.push(rawDistance * 1_000);
			} else {
				return null;
			}
		}
		distances.push(row);
	}
	return distances;
}

/** Fetch directed bike-network distances for every candidate entry/exit coordinate. */
export async function fetchValhallaDistanceMatrix(
	coordinates: Position[],
	config: ValhallaConfig
): Promise<TableResponse> {
	const fetchFn = config.fetchFn ?? fetch;
	let response: Response;
	try {
		response = await fetchFn(buildValhallaMatrixUrl(config.baseUrl), {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': config.userAgent
			},
			body: JSON.stringify(buildValhallaMatrixBody(coordinates))
		});
	} catch {
		return {
			ok: false,
			error: 'Couldn’t optimize shape order — couldn’t reach the routing server.',
			status: 502
		};
	}

	let body: ValhallaMatrixResponse | null;
	try {
		body = (await response.json()) as ValhallaMatrixResponse;
	} catch {
		body = null;
	}

	if (!body) {
		return {
			ok: false,
			error: 'Couldn’t optimize shape order — invalid routing response.',
			status: response.ok ? 502 : response.status
		};
	}

	if (!response.ok || body.error) {
		const message = body.error?.trim() || `routing server error (${response.status})`;
		return {
			ok: false,
			error: `Couldn’t optimize shape order — ${message}.`,
			status: response.ok ? (body.status_code ?? body.error_code ?? 502) : response.status
		};
	}

	const distances = normalizeDistances(body.sources_to_targets?.distances, coordinates.length);
	if (!distances) {
		return {
			ok: false,
			error: 'Couldn’t optimize shape order — invalid routing response.',
			status: 502
		};
	}

	return { ok: true, distances };
}
