import { VALHALLA_BASE_URL } from '$app/env/private';
import type { ValhallaConfig } from './types.server';

const USER_AGENT = 'gpx-art/0.0.1 (routing and attribution; fair-use Valhalla client)';

/** Server Valhalla settings. `src/env.ts` trims `VALHALLA_BASE_URL` and supplies the default. */
export function valhallaConfig(): ValhallaConfig {
	return { baseUrl: VALHALLA_BASE_URL, userAgent: USER_AGENT };
}
