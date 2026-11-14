import type { RequestHandler } from './$types';
import { fetchValhallaAttributes } from '#lib/routing/providers/valhalla/attributes.server.js';
import { valhallaConfig } from '#lib/routing/providers/valhalla/config.server.js';
import { apiStatus, providerFailureStatus } from '../contract.server';
import { json, readBody } from './contract.server';

/** Attribute an accepted route geometry with road edges and display spans. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	if (!body.ok) return json(apiStatus.badRequest, body);

	const result = await fetchValhallaAttributes(body.data.geometry, valhallaConfig());
	return result.ok ? json(apiStatus.ok, result) : json(providerFailureStatus(result), result);
};
