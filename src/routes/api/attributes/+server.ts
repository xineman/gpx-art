import type { RequestHandler } from './$types';
import { parseRouteGeometry } from '#lib/routing/attribution/attributes.server.js';
import { fetchValhallaAttributes } from '#lib/routing/providers/valhalla/attributes.server.js';
import { resolveValhallaConfig } from '#lib/routing/providers/valhalla/config.server.js';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ ok: false, error: 'Request body must be JSON.' }, { status: 400 });
	}

	const parsed = parseRouteGeometry(body);
	if (!parsed.ok) return Response.json(parsed, { status: 400 });

	const valhalla = resolveValhallaConfig();
	if (!valhalla.ok) return Response.json(valhalla, { status: 503 });

	const result = await fetchValhallaAttributes(parsed.geometry, valhalla.config);
	return Response.json(result, {
		status: result.ok ? 200 : result.error.includes('unavailable') ? 502 : 400
	});
};
