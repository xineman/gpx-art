/** OpenFreeMap Liberty vector tile style */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Warsaw city center [longitude, latitude] */
export const WARSAW_CENTER: [number, number] = [21.0122, 52.2297];

/**
 * Approximate administrative bounds of Warsaw
 * (southwest → northeast) so the whole city fits the viewport.
 */
export const WARSAW_BOUNDS: [[number, number], [number, number]] = [
	[20.85, 52.09],
	[21.27, 52.37]
];

/** Fallback zoom when bounds fitting is not used */
export const WARSAW_ZOOM = 11;
