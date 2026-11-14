import type { Position } from 'geojson';
import type { MatrixApiResponse } from '../../shape-optimization/matrix-response';
import { postValhalla, PROVIDER_UNAVAILABLE_STATUS } from './http.server';
import type { ValhallaConfig } from './types.server';

type ValhallaMatrixResponse = {
	sources_to_targets?: {
		distances?: unknown;
	};
};

const INVALID_MATRIX_ERROR = 'Couldn’t optimize shape order — invalid routing response.';

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
): Promise<MatrixApiResponse> {
	const reply = await postValhalla<ValhallaMatrixResponse>(
		config,
		'sources_to_targets',
		buildValhallaMatrixBody(coordinates)
	);
	if (!reply.ok) {
		switch (reply.reason) {
			case 'unreachable':
				return {
					ok: false,
					error: 'Couldn’t optimize shape order — couldn’t reach the routing server.',
					status: reply.status
				};
			case 'unreadable':
				return { ok: false, error: INVALID_MATRIX_ERROR, status: reply.status };
			case 'rejected': {
				const message = reply.message || `routing server error (${reply.httpStatus})`;
				return {
					ok: false,
					error: `Couldn’t optimize shape order — ${message}.`,
					status: reply.status
				};
			}
		}
	}

	const distances = normalizeDistances(
		reply.body.sources_to_targets?.distances,
		coordinates.length
	);
	if (!distances) {
		return { ok: false, error: INVALID_MATRIX_ERROR, status: PROVIDER_UNAVAILABLE_STATUS };
	}

	return { ok: true, distances };
}
