import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { generateRouteFromLegs, validateRouteLegs } from '$lib/routing/generate';
import type { RouteLegInput } from '$lib/routing/types';

const DEFAULT_OSRM_BASE = 'https://routing.openstreetmap.de/routed-bike';
const DEFAULT_OSRM_PROFILE = 'driving';
const USER_AGENT = 'gpx-art/0.0.1 (sketch-to-bike-route; fair-use OSRM client)';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Request body must be JSON.' }, { status: 400 });
	}

	if (!body || typeof body !== 'object' || !('legs' in body)) {
		return json({ ok: false, error: 'Body must include a legs array.' }, { status: 400 });
	}

	const legs = (body as { legs: unknown }).legs;
	const validationError = validateRouteLegs(legs);
	if (validationError) {
		return json({ ok: false, error: validationError }, { status: 400 });
	}

	const baseUrl = (env.OSRM_BASE_URL ?? DEFAULT_OSRM_BASE).trim();
	const profile = (env.OSRM_PROFILE ?? DEFAULT_OSRM_PROFILE).trim();

	if (!baseUrl) {
		return json(
			{ ok: false, error: 'Routing isn’t configured (missing OSRM_BASE_URL).' },
			{ status: 503 }
		);
	}

	const result = await generateRouteFromLegs(legs as RouteLegInput[], {
		osrm: {
			baseUrl,
			profile: profile || DEFAULT_OSRM_PROFILE,
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
