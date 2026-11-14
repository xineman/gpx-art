import type { RequestHandler } from './$types';
import { fetchValhallaAttributes } from '#lib/routing/providers/valhalla/attributes.server.js';
import { resolveValhallaConfig } from '#lib/routing/providers/valhalla/config.server.js';
import { apiStatus } from '../contract.server';
import { json, readBody } from './contract.server';

export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	if (!body.ok) return json(apiStatus.badRequest, body);

	const valhalla = resolveValhallaConfig();
	if (!valhalla.ok) return json(apiStatus.unavailable, valhalla);

	const result = await fetchValhallaAttributes(body.data.geometry, valhalla.config);
	if (result.ok) return json(apiStatus.ok, result);
	const status = result.error.includes('unavailable') ? apiStatus.badGateway : apiStatus.badRequest;
	return json(status, result);
};
