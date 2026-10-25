import type { RequestHandler } from './$types';
import { parseMatrixRequest } from '#lib/routing/shape-optimization/matrix.server.js';
import { resolveValhallaConfig } from '#lib/routing/providers/valhalla/config.server.js';
import { fetchValhallaDistanceMatrix } from '#lib/routing/providers/valhalla/matrix.server.js';
import type { RouteFailure } from '#lib/routing/shared/failure.js';

function matrixFailureHttpStatus(failure: RouteFailure): number {
	if (failure.status === 400) return 400;
	if (failure.status === 429) return 429;
	return 502;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ ok: false, error: 'Request body must be JSON.' }, { status: 400 });
	}

	const parsed = parseMatrixRequest(body);
	if (!parsed.ok) {
		return Response.json(parsed, { status: 400 });
	}

	const valhalla = resolveValhallaConfig();
	if (!valhalla.ok) {
		return Response.json(valhalla, { status: 503 });
	}

	const result = await fetchValhallaDistanceMatrix(parsed.request.coordinates, valhalla.config);
	if (!result.ok) {
		return Response.json(result, { status: matrixFailureHttpStatus(result) });
	}

	return Response.json(result);
};
