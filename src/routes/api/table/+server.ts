import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveOsrmConfig } from '$lib/routing/server/config.server';
import { fetchOsrmDistanceTable } from '$lib/routing/server/osrm.server';
import { parseTableRequest } from '$lib/routing/server/table.server';

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

	const osrm = resolveOsrmConfig();
	if (!osrm.ok) {
		return json(osrm, { status: 503 });
	}

	const result = await fetchOsrmDistanceTable(parsed.request.coordinates, osrm.config);
	if (!result.ok) {
		return json({ ok: false, error: result.error }, { status: 502 });
	}

	return json(result);
};
