import { env } from '$env/dynamic/private';
import type { ValhallaConfig } from '../valhalla';

const DEFAULT_VALHALLA_BASE = 'https://valhalla1.openstreetmap.de';
const USER_AGENT = 'gpx-art/0.0.1 (sketch-to-bike-map-match; fair-use Valhalla client)';

export type ValhallaConfigResult =
	{ ok: true; config: ValhallaConfig } | { ok: false; error: string };

export function resolveValhallaConfig(): ValhallaConfigResult {
	const baseUrl = (env.VALHALLA_BASE_URL ?? DEFAULT_VALHALLA_BASE).trim();
	if (!baseUrl) {
		return { ok: false, error: 'Routing isn’t configured (missing VALHALLA_BASE_URL).' };
	}
	return {
		ok: true,
		config: {
			baseUrl,
			userAgent: USER_AGENT
		}
	};
}
