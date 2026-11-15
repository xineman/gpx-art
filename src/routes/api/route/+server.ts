import type { RequestHandler } from './$types';
import { valhallaConfig } from '#lib/routing/providers/valhalla/config.server.js';
import { fetchValhallaTrace } from '#lib/routing/providers/valhalla/trace.server.js';
import { apiStatus, providerFailureStatus } from '../contract.server';
import { json, readBody } from './contract.server';

/** Match ordered vias to one continuous bicycle route. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	if (!body.ok) return json(apiStatus.badRequest, body);

	const result = await fetchValhallaTrace(body.data, valhallaConfig());
	return result.ok ? json(apiStatus.ok, result) : json(providerFailureStatus(result), result);
};
