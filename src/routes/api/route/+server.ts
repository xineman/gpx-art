import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { generateRoute, parseRouteRequest } from '$lib/routing/generate';

const DEFAULT_VALHALLA_BASE = 'https://valhalla1.openstreetmap.de';
const USER_AGENT = 'gpx-art/0.0.1 (sketch-to-bike-map-match; fair-use Valhalla client)';

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

	const baseUrl = (env.VALHALLA_BASE_URL ?? DEFAULT_VALHALLA_BASE).trim();

	if (!baseUrl) {
		return json(
			{ ok: false, error: 'Routing isn’t configured (missing VALHALLA_BASE_URL).' },
			{ status: 503 }
		);
	}

	const result = await generateRoute(parsed.request, {
		valhalla: {
			baseUrl,
			userAgent: USER_AGENT
		}
	});

	if (!result.ok) {
		const status =
			result.error.includes('reach the routing') || result.error.includes('server error')
				? 502
				: 400;
		return json(result, { status });
	}

	return json(result);
};
