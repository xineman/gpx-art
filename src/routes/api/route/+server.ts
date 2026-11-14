import type { RequestHandler } from './$types';
import { generateRoute } from '#lib/routing/matching/route.server.js';
import { resolveValhallaConfig } from '#lib/routing/providers/valhalla/config.server.js';
import type { RouteFailure } from '#lib/routing/shared/failure.js';
import { apiStatus } from '../contract.server';
import { json, readBody } from './contract.server';

function routeFailureHttpStatus(failure: RouteFailure) {
	if (failure.status === 429) return apiStatus.rateLimited;
	if (failure.status == null || failure.status === 400) return apiStatus.badRequest;
	return apiStatus.badGateway;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	if (!body.ok) return json(apiStatus.badRequest, body);

	const valhalla = resolveValhallaConfig();
	if (!valhalla.ok) {
		return json(apiStatus.unavailable, valhalla);
	}

	const result = await generateRoute(body.data, {
		valhalla: valhalla.config
	});

	if (!result.ok) {
		return json(routeFailureHttpStatus(result), result);
	}

	return json(apiStatus.ok, result);
};
