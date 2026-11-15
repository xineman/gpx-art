import type { RequestHandler } from './$types';
import { valhallaConfig } from '#lib/routing/providers/valhalla/config.server.js';
import { fetchValhallaDistanceMatrix } from '#lib/routing/providers/valhalla/matrix.server.js';
import { apiStatus, providerFailureStatus } from '../contract.server';
import { json, readBody } from './contract.server';

/** Fetch bicycle distances for the browser's shape-order optimizer. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	if (!body.ok) return json(apiStatus.badRequest, body);

	const result = await fetchValhallaDistanceMatrix(body.data.coordinates, valhallaConfig());
	return result.ok ? json(apiStatus.ok, result) : json(providerFailureStatus(result), result);
};
