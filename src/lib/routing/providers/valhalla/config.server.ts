import { VALHALLA_BASE_URL } from '$app/env/private';
import type { ValhallaConfig } from './types.server';

const DEFAULT_VALHALLA_BASE = 'https://valhalla1.openstreetmap.de';
const USER_AGENT = 'gpx-art/0.0.1 (routing and attribution; fair-use Valhalla client)';

export type ValhallaConfigResult =
	{ ok: true; config: ValhallaConfig } | { ok: false; error: string };

export function resolveValhallaConfig(): ValhallaConfigResult {
	const baseUrl = (VALHALLA_BASE_URL ?? DEFAULT_VALHALLA_BASE).trim();
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
