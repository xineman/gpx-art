import type { RequestHandler } from './$types';
import { generateRoute, parseRouteRequest } from '#lib/routing/matching/route.server.js';
import { resolveValhallaConfig } from '#lib/routing/providers/valhalla/config.server.js';
import type { RouteFailure } from '#lib/routing/shared/failure.js';

function routeFailureHttpStatus(failure: RouteFailure): number {
	if (failure.status === 400) return 400;
	if (failure.status === 429) return 429;
	if (failure.status != null) return 502;
	return 400;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ ok: false, error: 'Request body must be JSON.' }, { status: 400 });
	}

	const parsed = parseRouteRequest(body);
	if (!parsed.ok) {
		return Response.json(parsed, { status: 400 });
	}

	const valhalla = resolveValhallaConfig();
	if (!valhalla.ok) {
		return Response.json(valhalla, { status: 503 });
	}

	const result = await generateRoute(parsed.request, {
		valhalla: valhalla.config
	});

	if (!result.ok) {
		return Response.json(result, { status: routeFailureHttpStatus(result) });
	}

	return Response.json(result);
};
