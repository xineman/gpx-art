import 'leaflet/dist/leaflet.css';

import type * as Leaflet from 'leaflet';
import { MAP_CENTER, MAP_ZOOM, MAX_ZOOM, TILE_ATTRIBUTION, TILE_URL } from '$lib/constants/map';
import type { MapHandle, SketchState } from '$lib/sketch/state.svelte';
import { renderLayers } from './renderer';

export interface MapController extends MapHandle {
	teardown: () => void;
}

export async function createMap(el: HTMLDivElement, state: SketchState): Promise<MapController> {
	const L = await import('leaflet');
	const map = L.map(el, {
		center: MAP_CENTER,
		doubleClickZoom: false,
		zoom: MAP_ZOOM,
		zoomControl: false
	});

	L.control.zoom({ position: 'bottomright' }).addTo(map);
	L.tileLayer(TILE_URL, {
		attribution: TILE_ATTRIBUTION,
		maxZoom: MAX_ZOOM
	}).addTo(map);

	const drawingLayer = L.layerGroup().addTo(map);
	const routeLayer = L.layerGroup().addTo(map);
	// Third layer for the OSRM batch debug overlay. Cleared on every
	// render alongside the route layer; markers stay non-interactive so
	// they never intercept clicks intended for the drawing or route layer.
	const debugLayer = L.layerGroup().addTo(map);

	map.on('mousedown', (event: Leaflet.LeafletMouseEvent) => state.handleMapMouseDown(event));
	map.on('mousemove', (event: Leaflet.LeafletMouseEvent) => state.handleMapMouseMove(event));
	map.on('mouseup', () => state.handleMapMouseUp());
	map.on('click', (event: Leaflet.LeafletMouseEvent) => state.handleMapClick(event));
	map.on('dblclick', () => state.finishDraft());
	map.on('contextmenu', () => state.finishDraft());

	renderLayers(
		L,
		map,
		drawingLayer,
		state.shapes,
		state.draft,
		undefined,
		() => false,
		routeLayer,
		state.routedPath,
		false,
		null,
		null,
		undefined,
		debugLayer,
		state.routeDebugVisible ? state.routeDebugBatches : []
	);

	return {
		L,
		map,
		drawingLayer,
		routeLayer,
		debugLayer,
		teardown: () => {
			map.off();
			map.remove();
		}
	};
}
