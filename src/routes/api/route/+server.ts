import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveValhallaConfig } from '$lib/routing/server/config.server';
import { generateRoute, parseRouteRequest } from '$lib/routing/server/route.server';
import type { RouteFailure } from '$lib/routing/types';

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
		return json({ ok: false, error: 'Request body must be JSON.' }, { status: 400 });
	}

	const parsed = parseRouteRequest(body);
	if (!parsed.ok) {
		return json(parsed, { status: 400 });
	}

	const valhalla = resolveValhallaConfig();
	if (!valhalla.ok) {
		return json(valhalla, { status: 503 });
	}

	const result = await generateRoute(parsed.request, {
		valhalla: valhalla.config
	});

	if (!result.ok) {
		return json(result, { status: routeFailureHttpStatus(result) });
	}

	return json(result);
};
