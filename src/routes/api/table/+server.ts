import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveValhallaConfig } from '$lib/routing/server/config.server';
import { parseTableRequest } from '$lib/routing/server/table.server';
import { fetchValhallaDistanceMatrix } from '$lib/routing/server/valhalla-matrix.server';
import type { RouteFailure } from '$lib/routing/types';

function tableFailureHttpStatus(failure: RouteFailure): number {
	if (failure.status === 400) return 400;
	if (failure.status === 429) return 429;
	return 502;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Request body must be JSON.' }, { status: 400 });
	}

	const parsed = parseTableRequest(body);
	if (!parsed.ok) {
		return json(parsed, { status: 400 });
	}

	const valhalla = resolveValhallaConfig();
	if (!valhalla.ok) {
		return json(valhalla, { status: 503 });
	}

	const result = await fetchValhallaDistanceMatrix(parsed.request.coordinates, valhalla.config);
	if (!result.ok) {
		return json(result, { status: tableFailureHttpStatus(result) });
	}

	return json(result);
};
