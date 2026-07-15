import type { FeatureCollection, Geometry } from 'geojson';
import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl';

export const DRAWINGS_SOURCE = 'gpx-drawings';
export const PREVIEW_SOURCE = 'gpx-draw-preview';
export const ROUTE_SOURCE = 'gpx-route';

const LINE_LAYER = 'gpx-drawings-line';
const FILL_LAYER = 'gpx-drawings-fill';
const PREVIEW_LINE = 'gpx-preview-line';
const PREVIEW_FILL = 'gpx-preview-fill';
const PREVIEW_POINTS = 'gpx-preview-points';
const ROUTE_LINE = 'gpx-route-line';
const ROUTE_LINE_CASING = 'gpx-route-line-casing';

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Resolve a `--color-*` token from `layout.css` @theme (MapLibre needs concrete values). */
function themeColor(token: string): string {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(`--color-${token}`)
		.trim();
	if (!value) {
		throw new Error(`Missing theme color --color-${token} (is it in layout.css @theme static?)`);
	}
	return value;
}

export function ensureDrawingLayers(map: MaplibreMap) {
	const stroke = themeColor('trail-deep');
	const fill = themeColor('trail');
	const vertex = themeColor('trail-vertex');

	if (!map.getSource(DRAWINGS_SOURCE)) {
		map.addSource(DRAWINGS_SOURCE, { type: 'geojson', data: empty });
	}
	if (!map.getSource(PREVIEW_SOURCE)) {
		map.addSource(PREVIEW_SOURCE, { type: 'geojson', data: empty });
	}

	if (!map.getLayer(FILL_LAYER)) {
		map.addLayer({
			id: FILL_LAYER,
			type: 'fill',
			source: DRAWINGS_SOURCE,
			filter: ['==', ['geometry-type'], 'Polygon'],
			paint: {
				'fill-color': fill,
				'fill-opacity': 0.22
			}
		});
	}

	if (!map.getLayer(LINE_LAYER)) {
		map.addLayer({
			id: LINE_LAYER,
			type: 'line',
			source: DRAWINGS_SOURCE,
			layout: {
				'line-cap': 'round',
				'line-join': 'round'
			},
			paint: {
				'line-color': stroke,
				'line-width': 2.75,
				'line-opacity': 0.95
			}
		});
	}

	if (!map.getLayer(PREVIEW_FILL)) {
		map.addLayer({
			id: PREVIEW_FILL,
			type: 'fill',
			source: PREVIEW_SOURCE,
			filter: ['==', ['geometry-type'], 'Polygon'],
			paint: {
				'fill-color': fill,
				'fill-opacity': 0.14
			}
		});
	}

	if (!map.getLayer(PREVIEW_LINE)) {
		map.addLayer({
			id: PREVIEW_LINE,
			type: 'line',
			source: PREVIEW_SOURCE,
			filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
			layout: {
				'line-cap': 'round',
				'line-join': 'round'
			},
			paint: {
				'line-color': stroke,
				'line-width': 2.25,
				'line-opacity': 0.85,
				'line-dasharray': [1.5, 1.5]
			}
		});
	}

	if (!map.getLayer(PREVIEW_POINTS)) {
		map.addLayer({
			id: PREVIEW_POINTS,
			type: 'circle',
			source: PREVIEW_SOURCE,
			filter: ['==', ['geometry-type'], 'Point'],
			paint: {
				'circle-radius': 4.5,
				'circle-color': vertex,
				'circle-stroke-color': stroke,
				'circle-stroke-width': 2
			}
		});
	}

	ensureRouteLayers(map);
}

/** Road-snapped route overlay (above sketch lines, below draft vertices). */
export function ensureRouteLayers(map: MaplibreMap) {
	const route = themeColor('blaze');
	const routeDeep = themeColor('ink-dark');

	if (!map.getSource(ROUTE_SOURCE)) {
		map.addSource(ROUTE_SOURCE, { type: 'geojson', data: empty });
	}

	if (!map.getLayer(ROUTE_LINE_CASING)) {
		map.addLayer({
			id: ROUTE_LINE_CASING,
			type: 'line',
			source: ROUTE_SOURCE,
			layout: {
				'line-cap': 'round',
				'line-join': 'round'
			},
			paint: {
				'line-color': routeDeep,
				'line-width': 6,
				'line-opacity': 0.45
			}
		});
	}

	if (!map.getLayer(ROUTE_LINE)) {
		map.addLayer({
			id: ROUTE_LINE,
			type: 'line',
			source: ROUTE_SOURCE,
			layout: {
				'line-cap': 'round',
				'line-join': 'round'
			},
			paint: {
				'line-color': route,
				'line-width': 3.25,
				'line-opacity': 0.95
			}
		});
	}
}

export function setSourceData(map: MaplibreMap, sourceId: string, data: FeatureCollection) {
	const source = map.getSource(sourceId) as GeoJSONSource | undefined;
	source?.setData(data);
}

export function previewCollection(
	geometry: Geometry | null,
	vertices: [number, number][] = []
): FeatureCollection {
	const features: FeatureCollection['features'] = [];

	if (geometry) {
		features.push({
			type: 'Feature',
			properties: {},
			geometry
		});
	}

	for (const [lng, lat] of vertices) {
		features.push({
			type: 'Feature',
			properties: {},
			geometry: { type: 'Point', coordinates: [lng, lat] }
		});
	}

	return { type: 'FeatureCollection', features };
}
