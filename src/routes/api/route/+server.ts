import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import type { Feature } from 'geojson';
import { generateRouteFromFeatures } from '$lib/routing/generate';

const DEFAULT_OSRM_BASE = 'https://routing.openstreetmap.de/routed-bike';
const DEFAULT_OSRM_PROFILE = 'driving';
const USER_AGENT = 'gpx-art/0.0.1 (sketch-to-bike-route; fair-use OSRM client)';

function isFeatureArray(value: unknown): value is Feature[] {
	return Array.isArray(value) && value.every((f) => f && typeof f === 'object' && 'type' in f);
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Request body must be JSON.' }, { status: 400 });
	}

	if (!body || typeof body !== 'object' || !('features' in body)) {
		return json({ ok: false, error: 'Body must include a features array.' }, { status: 400 });
	}

	const features = (body as { features: unknown }).features;
	if (!isFeatureArray(features)) {
		return json({ ok: false, error: 'features must be a GeoJSON Feature array.' }, { status: 400 });
	}

	if (features.length === 0) {
		return json({ ok: false, error: 'Sketch a shape first.' }, { status: 400 });
	}

	const baseUrl = (env.OSRM_BASE_URL ?? DEFAULT_OSRM_BASE).trim();
	const profile = (env.OSRM_PROFILE ?? DEFAULT_OSRM_PROFILE).trim();

	if (!baseUrl) {
		return json(
			{ ok: false, error: 'Routing isn’t configured (missing OSRM_BASE_URL).' },
			{ status: 503 }
		);
	}

	const result = await generateRouteFromFeatures(features, {
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
