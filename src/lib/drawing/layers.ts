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
const ROUTE_DETOURS = 'gpx-route-detours';
const ROUTE_CHEVRONS = 'gpx-route-chevrons';
export const ROUTE_WAYPOINTS = 'gpx-route-waypoints';
/** Sprite id registered via `map.addImage` for line-following direction marks. */
const ROUTE_CHEVRON_IMAGE = 'gpx-route-chevron';

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

/**
 * Canvas-drawn chevron pointing right (travel direction along LineString order).
 * With `symbol-placement: line`, MapLibre rotates it to match the path.
 */
function ensureRouteChevronImage(map: MaplibreMap) {
	if (map.hasImage(ROUTE_CHEVRON_IMAGE)) return;

	// High-res sprite; pixelRatio 2 → ~16 CSS px on map.
	const size = 32;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	const fill = themeColor('ink-dark');
	const edge = themeColor('trail-vertex');

	// Soft halo so chevrons stay readable on both blaze stroke and map basemap.
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.strokeStyle = edge;
	ctx.lineWidth = 5;
	ctx.beginPath();
	ctx.moveTo(8, 6);
	ctx.lineTo(22, 16);
	ctx.lineTo(8, 26);
	ctx.stroke();

	// Solid arrowhead (filled chevron) — clearer than a hairline at map scale.
	ctx.fillStyle = fill;
	ctx.beginPath();
	ctx.moveTo(7, 6);
	ctx.lineTo(23, 16);
	ctx.lineTo(7, 26);
	ctx.closePath();
	ctx.fill();

	// Inner notch so it reads as › not a solid triangle.
	ctx.globalCompositeOperation = 'destination-out';
	ctx.beginPath();
	ctx.moveTo(7, 10);
	ctx.lineTo(15, 16);
	ctx.lineTo(7, 22);
	ctx.closePath();
	ctx.fill();
	ctx.globalCompositeOperation = 'source-over';

	const imageData = ctx.getImageData(0, 0, size, size);
	map.addImage(
		ROUTE_CHEVRON_IMAGE,
		{
			width: size,
			height: size,
			data: new Uint8Array(imageData.data)
		},
		{ pixelRatio: 2 }
	);
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
	const detour = themeColor('ember');

	if (!map.getSource(ROUTE_SOURCE)) {
		map.addSource(ROUTE_SOURCE, { type: 'geojson', data: empty });
	}

	ensureRouteChevronImage(map);

	if (!map.getLayer(ROUTE_LINE_CASING)) {
		map.addLayer({
			id: ROUTE_LINE_CASING,
			type: 'line',
			source: ROUTE_SOURCE,
			filter: ['==', ['get', 'kind'], 'route'],
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
			filter: ['==', ['get', 'kind'], 'route'],
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

	// Suspected waypoint-driven excursions stay part of the route; ember only marks them.
	if (!map.getLayer(ROUTE_DETOURS)) {
		map.addLayer({
			id: ROUTE_DETOURS,
			type: 'line',
			source: ROUTE_SOURCE,
			filter: ['==', ['get', 'kind'], 'detour'],
			layout: {
				'line-cap': 'round',
				'line-join': 'round'
			},
			paint: {
				'line-color': detour,
				'line-width': 4.5,
				'line-opacity': 0.98
			}
		});
	}

	// Direction ticks: spaced along the geometry in draw order (start → end).
	if (!map.getLayer(ROUTE_CHEVRONS)) {
		map.addLayer({
			id: ROUTE_CHEVRONS,
			type: 'symbol',
			source: ROUTE_SOURCE,
			filter: ['==', ['get', 'kind'], 'route'],
			layout: {
				'symbol-placement': 'line',
				// Screen-pixel spacing along the path.
				'symbol-spacing': 44,
				'icon-image': ROUTE_CHEVRON_IMAGE,
				'icon-size': 1,
				'icon-rotation-alignment': 'map',
				'icon-pitch-alignment': 'map',
				'icon-keep-upright': false,
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
				'symbol-z-order': 'viewport-y'
			},
			paint: {
				'icon-opacity': 0.92
			}
		});
	}

	// Client-prepared OSRM vias — above line/chevrons so direction anchors stay readable.
	if (!map.getLayer(ROUTE_WAYPOINTS)) {
		const vertex = themeColor('trail-vertex');
		map.addLayer({
			id: ROUTE_WAYPOINTS,
			type: 'circle',
			source: ROUTE_SOURCE,
			filter: ['==', ['get', 'kind'], 'waypoint'],
			paint: {
				'circle-radius': [
					'case',
					['==', ['get', 'detour'], true],
					['match', ['get', 'role'], 'start', 6.5, 'end', 6.5, /* via */ 5.25],
					['match', ['get', 'role'], 'start', 6.5, 'end', 6.5, /* via */ 4.25]
				],
				'circle-color': [
					'case',
					['==', ['get', 'detour'], true],
					detour,
					['match', ['get', 'role'], 'start', vertex, 'end', route, /* via */ route]
				],
				'circle-stroke-color': routeDeep,
				'circle-stroke-width': [
					'match',
					['get', 'role'],
					'start',
					2.25,
					'end',
					2.25,
					/* via */ 1.75
				],
				'circle-opacity': 0.95
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
