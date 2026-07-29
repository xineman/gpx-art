import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseRouteGeometry } from '$lib/routing/attribution/attributes.server';
import { fetchValhallaAttributes } from '$lib/routing/providers/valhalla/attributes.server';
import { resolveValhallaConfig } from '$lib/routing/providers/valhalla/config.server';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Request body must be JSON.' }, { status: 400 });
	}

	const parsed = parseRouteGeometry(body);
	if (!parsed.ok) return json(parsed, { status: 400 });

	const valhalla = resolveValhallaConfig();
	if (!valhalla.ok) return json(valhalla, { status: 503 });

	const result = await fetchValhallaAttributes(parsed.geometry, valhalla.config);
	return json(result, {
		status: result.ok ? 200 : result.error.includes('unavailable') ? 502 : 400
	});
};
