import type { FeatureCollection, Geometry } from 'geojson';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { EMPTY_FEATURE_COLLECTION } from '#lib/map/sources.js';
import { themeColor } from '#lib/map/theme.js';

export const DRAWINGS_SOURCE = 'gpx-drawings';
export const PREVIEW_SOURCE = 'gpx-draw-preview';

const LINE_LAYER = 'gpx-drawings-line';
const PREVIEW_LINE = 'gpx-preview-line';
const PREVIEW_POINTS = 'gpx-preview-points';

export function ensureDrawingLayers(map: MaplibreMap) {
	const stroke = themeColor('trail-deep');
	const vertex = themeColor('trail-vertex');

	if (!map.getSource(DRAWINGS_SOURCE)) {
		map.addSource(DRAWINGS_SOURCE, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
	}
	if (!map.getSource(PREVIEW_SOURCE)) {
		map.addSource(PREVIEW_SOURCE, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
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
