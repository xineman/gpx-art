import { env } from '$env/dynamic/private';
import type { OsrmConfig } from './osrm.server';

const DEFAULT_OSRM_BASE = 'https://routing.openstreetmap.de/routed-bike';
const DEFAULT_OSRM_PROFILE = 'driving';
const USER_AGENT = 'gpx-art/0.0.1 (sketch-to-bike-route; fair-use OSRM client)';

export type OsrmConfigResult = { ok: true; config: OsrmConfig } | { ok: false; error: string };

export function resolveOsrmConfig(): OsrmConfigResult {
	const baseUrl = (env.OSRM_BASE_URL ?? DEFAULT_OSRM_BASE).trim();
	const profile = (env.OSRM_PROFILE ?? DEFAULT_OSRM_PROFILE).trim();
	if (!baseUrl) {
		return { ok: false, error: 'Routing isn’t configured (missing OSRM_BASE_URL).' };
	}
	return {
		ok: true,
		config: {
			baseUrl,
			profile: profile || DEFAULT_OSRM_PROFILE,
			userAgent: USER_AGENT
		}
	};
}
