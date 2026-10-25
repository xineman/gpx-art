import { defineEnvVars } from '@sveltejs/kit/env';

const DEFAULT_VALHALLA_BASE_URL = 'https://valhalla1.openstreetmap.de';

export const variables = defineEnvVars({
	VALHALLA_BASE_URL: {
		schema: (input) => input?.trim() || DEFAULT_VALHALLA_BASE_URL
	}
});
