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
const ROUTE_ROAD_HIGHLIGHT_CASING = 'gpx-route-road-highlight-casing';
const ROUTE_ROAD_HIGHLIGHT = 'gpx-route-road-highlight';
const ROUTE_DETOURS = 'gpx-route-detours';
const ROUTE_CHEVRONS = 'gpx-route-chevrons';
const ROUTE_MOVE_LINK = 'gpx-route-move-link';
const ROUTE_MOVE_TARGET = 'gpx-route-move-target';
const ROUTE_MOVE_TARGET_ICON = 'gpx-route-move-target-icon';
export const ROUTE_WAYPOINTS = 'gpx-route-waypoints';
const ROUTE_WAYPOINT_ACTIONS = 'gpx-route-waypoint-actions';
/** Sprite id registered via `map.addImage` for line-following direction marks. */
const ROUTE_CHEVRON_IMAGE = 'gpx-route-chevron';
const ROUTE_MOVE_WAYPOINT_IMAGE = 'gpx-route-waypoint-move';
const ROUTE_REMOVE_WAYPOINT_IMAGE = 'gpx-route-waypoint-remove';
const ROUTE_MOVE_TARGET_IMAGE = 'gpx-route-move-target-reticle';

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

/** Compact action glyphs layered over route-waypoint circles. */
function ensureRouteWaypointActionImages(map: MaplibreMap) {
	const ink = themeColor('ink-dark');

	function addActionImage(id: string, action: 'move' | 'remove') {
		if (map.hasImage(id)) return;

		const size = 32;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		ctx.strokeStyle = ink;
		ctx.lineWidth = 4;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		if (action === 'move') {
			// A short diagonal arrow reads as a map nudge without implying route direction.
			ctx.moveTo(9, 23);
			ctx.lineTo(22, 10);
			ctx.moveTo(15, 10);
			ctx.lineTo(22, 10);
			ctx.lineTo(22, 17);
		} else {
			ctx.moveTo(9, 16);
			ctx.lineTo(23, 16);
		}
		ctx.stroke();

		const imageData = ctx.getImageData(0, 0, size, size);
		map.addImage(
			id,
			{
				width: size,
				height: size,
				data: new Uint8Array(imageData.data)
			},
			{ pixelRatio: 2 }
		);
	}

	addActionImage(ROUTE_MOVE_WAYPOINT_IMAGE, 'move');
	addActionImage(ROUTE_REMOVE_WAYPOINT_IMAGE, 'remove');
}

/** Survey reticle marking the exact destination of a proposed waypoint move. */
function ensureRouteMoveTargetImage(map: MaplibreMap) {
	if (map.hasImage(ROUTE_MOVE_TARGET_IMAGE)) return;

	const size = 32;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	const drawTicks = () => {
		ctx.beginPath();
		ctx.moveTo(7, 16);
		ctx.lineTo(12, 16);
		ctx.moveTo(20, 16);
		ctx.lineTo(25, 16);
		ctx.moveTo(16, 7);
		ctx.lineTo(16, 12);
		ctx.moveTo(16, 20);
		ctx.lineTo(16, 25);
		ctx.stroke();
	};

	// A light under-stroke keeps the fine reticle legible over streets and labels.
	ctx.strokeStyle = themeColor('trail-vertex');
	ctx.lineWidth = 5;
	drawTicks();
	ctx.fillStyle = themeColor('trail-vertex');
	ctx.beginPath();
	ctx.arc(16, 16, 4, 0, Math.PI * 2);
	ctx.fill();

	ctx.strokeStyle = themeColor('ember');
	ctx.lineWidth = 2.5;
	drawTicks();
	ctx.fillStyle = themeColor('ember');
	ctx.beginPath();
	ctx.arc(16, 16, 2, 0, Math.PI * 2);
	ctx.fill();

	const imageData = ctx.getImageData(0, 0, size, size);
	map.addImage(
		ROUTE_MOVE_TARGET_IMAGE,
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
	const vertex = themeColor('trail-vertex');
	const roadNational = themeColor('road-national');
	const roadVoivodeship = themeColor('road-voivodeship');
	const roadCounty = themeColor('road-county');
	const roadMunicipal = themeColor('road-municipal');
	const roadOther = themeColor('road-other');
	const transitionDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
		? 0
		: 180;

	if (!map.getSource(ROUTE_SOURCE)) {
		map.addSource(ROUTE_SOURCE, { type: 'geojson', data: empty });
	}

	ensureRouteChevronImage(map);
	ensureRouteWaypointActionImages(map);
	ensureRouteMoveTargetImage(map);

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

	if (!map.getLayer(ROUTE_ROAD_HIGHLIGHT_CASING)) {
		map.addLayer({
			id: ROUTE_ROAD_HIGHLIGHT_CASING,
			type: 'line',
			source: ROUTE_SOURCE,
			filter: ['==', ['get', 'kind'], 'road-highlight'],
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': themeColor('panel-edge'),
				'line-width': 9,
				'line-opacity': 0.92
			}
		});
	}

	if (!map.getLayer(ROUTE_ROAD_HIGHLIGHT)) {
		map.addLayer({
			id: ROUTE_ROAD_HIGHLIGHT,
			type: 'line',
			source: ROUTE_SOURCE,
			filter: ['==', ['get', 'kind'], 'road-highlight'],
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': [
					'match',
					['get', 'roadKind'],
					'national',
					roadNational,
					'voivodeship',
					roadVoivodeship,
					'county',
					roadCounty,
					'municipal',
					roadMunicipal,
					roadOther
				],
				'line-width': 6,
				'line-opacity': 1
			}
		});
	}

	// Move actions retain a prominent route segment so the proposed correction is visible.
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
				'line-width': ['case', ['==', ['get', 'activeMove'], true], 4.5, 3],
				'line-opacity': ['case', ['==', ['get', 'activeMove'], true], 0.98, 0.3],
				'line-opacity-transition': { duration: transitionDuration }
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

	// One survey line at a time ties the current waypoint to its proposed position.
	if (!map.getLayer(ROUTE_MOVE_LINK)) {
		map.addLayer({
			id: ROUTE_MOVE_LINK,
			type: 'line',
			source: ROUTE_SOURCE,
			filter: ['==', ['get', 'kind'], 'move-link'],
			layout: {
				'line-cap': 'round',
				'line-join': 'round'
			},
			paint: {
				'line-color': detour,
				'line-width': 2,
				'line-dasharray': [1.4, 1.8],
				'line-opacity': ['case', ['==', ['get', 'activeMove'], true], 0.9, 0],
				'line-opacity-transition': { duration: transitionDuration }
			}
		});
	}

	// Hollow registration rings keep every proposed position visible without adding more paths.
	if (!map.getLayer(ROUTE_MOVE_TARGET)) {
		map.addLayer({
			id: ROUTE_MOVE_TARGET,
			type: 'circle',
			source: ROUTE_SOURCE,
			filter: ['==', ['get', 'kind'], 'move-target'],
			paint: {
				'circle-radius': ['case', ['==', ['get', 'activeMove'], true], 8, 5.5],
				'circle-color': vertex,
				'circle-opacity': ['case', ['==', ['get', 'activeMove'], true], 0.88, 0.2],
				'circle-stroke-color': detour,
				'circle-stroke-width': ['case', ['==', ['get', 'activeMove'], true], 3, 1.75],
				'circle-stroke-opacity': ['case', ['==', ['get', 'activeMove'], true], 1, 0.55],
				'circle-radius-transition': { duration: transitionDuration },
				'circle-opacity-transition': { duration: transitionDuration },
				'circle-stroke-opacity-transition': { duration: transitionDuration }
			}
		});
	}

	// Client-prepared trace points — above line/chevrons so direction anchors stay readable.
	if (!map.getLayer(ROUTE_WAYPOINTS)) {
		map.addLayer({
			id: ROUTE_WAYPOINTS,
			type: 'circle',
			source: ROUTE_SOURCE,
			filter: ['==', ['get', 'kind'], 'waypoint'],
			paint: {
				'circle-radius': [
					'case',
					['==', ['get', 'action'], 'move'],
					['match', ['get', 'role'], 'start', 7, 'end', 7, /* via */ 6.25],
					['==', ['get', 'action'], 'remove'],
					['match', ['get', 'role'], 'start', 7, 'end', 7, /* via */ 6.25],
					['all', ['==', ['get', 'candidate'], true], ['==', ['get', 'action'], 'keep']],
					['match', ['get', 'role'], 'start', 6.5, 'end', 6.5, /* via */ 5.25],
					['match', ['get', 'role'], 'start', 6.5, 'end', 6.5, /* via */ 4.25]
				],
				'circle-color': [
					'case',
					['==', ['get', 'action'], 'remove'],
					detour,
					['==', ['get', 'action'], 'move'],
					detour,
					['all', ['==', ['get', 'candidate'], true], ['==', ['get', 'action'], 'keep']],
					routeDeep,
					['match', ['get', 'role'], 'start', vertex, 'end', route, /* via */ route]
				],
				'circle-stroke-color': [
					'case',
					['all', ['==', ['get', 'action'], 'move'], ['==', ['get', 'activeMove'], true]],
					vertex,
					['all', ['==', ['get', 'candidate'], true], ['==', ['get', 'action'], 'keep']],
					route,
					routeDeep
				],
				'circle-stroke-width': [
					'case',
					['all', ['==', ['get', 'action'], 'move'], ['==', ['get', 'activeMove'], true]],
					2.75,
					['all', ['==', ['get', 'candidate'], true], ['==', ['get', 'action'], 'keep']],
					2.5,
					['match', ['get', 'role'], 'start', 2.25, 'end', 2.25, /* via */ 1.75]
				],
				'circle-opacity': 0.95
			}
		});
	}

	if (!map.getLayer(ROUTE_WAYPOINT_ACTIONS)) {
		map.addLayer({
			id: ROUTE_WAYPOINT_ACTIONS,
			type: 'symbol',
			source: ROUTE_SOURCE,
			filter: ['in', ['get', 'action'], ['literal', ['move', 'remove']]],
			layout: {
				'icon-image': [
					'match',
					['get', 'action'],
					'move',
					ROUTE_MOVE_WAYPOINT_IMAGE,
					'remove',
					ROUTE_REMOVE_WAYPOINT_IMAGE,
					ROUTE_MOVE_WAYPOINT_IMAGE
				],
				'icon-size': 0.8,
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
				'icon-rotation-alignment': 'viewport',
				'icon-pitch-alignment': 'viewport'
			},
			paint: {
				'icon-opacity': 0.95
			}
		});
	}

	// Render destinations last so nearby waypoint/action markers cannot obscure the reticle.
	if (!map.getLayer(ROUTE_MOVE_TARGET_ICON)) {
		map.addLayer({
			id: ROUTE_MOVE_TARGET_ICON,
			type: 'symbol',
			source: ROUTE_SOURCE,
			filter: ['==', ['get', 'kind'], 'move-target'],
			layout: {
				'icon-image': ROUTE_MOVE_TARGET_IMAGE,
				'icon-size': ['case', ['==', ['get', 'activeMove'], true], 1.25, 0.82],
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
				'icon-rotation-alignment': 'viewport',
				'icon-pitch-alignment': 'viewport'
			},
			paint: {
				'icon-opacity': ['case', ['==', ['get', 'activeMove'], true], 1, 0.62],
				'icon-opacity-transition': { duration: transitionDuration }
			}
		});
	} else {
		map.moveLayer(ROUTE_MOVE_TARGET_ICON);
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
