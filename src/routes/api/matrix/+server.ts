import type { RequestHandler } from './$types';
import { resolveValhallaConfig } from '#lib/routing/providers/valhalla/config.server.js';
import { fetchValhallaDistanceMatrix } from '#lib/routing/providers/valhalla/matrix.server.js';
import type { ApiFailure } from '#lib/routing/shared/api-response.js';
import { apiStatus } from '../contract.server';
import { json, readBody } from './contract.server';

function matrixFailureHttpStatus(failure: ApiFailure) {
	if (failure.status === 400) return apiStatus.badRequest;
	if (failure.status === 429) return apiStatus.rateLimited;
	return apiStatus.badGateway;
}

/** Fetch bicycle distances for the browser's shape-order optimizer. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	if (!body.ok) return json(apiStatus.badRequest, body);

	const valhalla = resolveValhallaConfig();
	if (!valhalla.ok) {
		return json(apiStatus.unavailable, valhalla);
	}

	const result = await fetchValhallaDistanceMatrix(body.data.coordinates, valhalla.config);
	if (!result.ok) {
		return json(matrixFailureHttpStatus(result), result);
	}

	return json(apiStatus.ok, result);
};
