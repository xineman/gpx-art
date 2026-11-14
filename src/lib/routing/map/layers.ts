import type { Map as MaplibreMap } from 'maplibre-gl';
import { EMPTY_FEATURE_COLLECTION } from '#lib/map/sources.js';
import { themeColor } from '#lib/map/theme.js';
import {
	ROUTE_CHEVRON_IMAGE,
	ROUTE_MOVE_TARGET_IMAGE,
	ROUTE_MOVE_WAYPOINT_IMAGE,
	ROUTE_REMOVE_WAYPOINT_IMAGE,
	ensureRouteSprites
} from './sprites';

export const ROUTE_SOURCE = 'gpx-route';

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
		map.addSource(ROUTE_SOURCE, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
	}

	ensureRouteSprites(map);

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
