import type { FeatureCollection, Geometry } from 'geojson';
import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl';

export const DRAWINGS_SOURCE = 'gpx-drawings';
export const PREVIEW_SOURCE = 'gpx-draw-preview';

const LINE_LAYER = 'gpx-drawings-line';
const FILL_LAYER = 'gpx-drawings-fill';
const PREVIEW_LINE = 'gpx-preview-line';
const PREVIEW_FILL = 'gpx-preview-fill';
const PREVIEW_POINTS = 'gpx-preview-points';

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Trail-marker teal on the map — reads as inked GPS art. */
const STROKE = '#0d9488';
const FILL = '#14b8a6';

export function ensureDrawingLayers(map: MaplibreMap) {
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
				'fill-color': FILL,
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
				'line-color': STROKE,
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
				'fill-color': FILL,
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
				'line-color': STROKE,
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
				'circle-color': '#f4f0e8',
				'circle-stroke-color': STROKE,
				'circle-stroke-width': 2
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
