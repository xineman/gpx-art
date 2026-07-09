import 'maplibre-gl/dist/maplibre-gl.css';

import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { MAP_CENTER, MAP_ZOOM, MAX_ZOOM, STYLE_URL } from '$lib/constants/map';
import { ROUTE_COLOR } from '$lib/constants/routing';
import type { MapHandle, SketchState } from '$lib/sketch/state.svelte';
import type { MapPointerEvent } from './types';
import {
	bindMapInteractions,
	consumeSuppressedClick,
	isMapFeatureDragging,
	renderLayers,
	resetMapInteractions
} from './renderer';
import { initDrawingLayers } from './sources';

export interface MapController extends MapHandle {
	teardown: () => void;
}

function toPointerEvent(e: MapMouseEvent): MapPointerEvent {
	return {
		point: { lat: e.lngLat.lat, lng: e.lngLat.lng },
		originalEvent: e.originalEvent
	};
}

export async function createMap(el: HTMLDivElement, state: SketchState): Promise<MapController> {
	const maplibregl = await import('maplibre-gl');

	const map: MapLibreMap = new maplibregl.Map({
		container: el,
		style: STYLE_URL,
		center: [MAP_CENTER.lng, MAP_CENTER.lat],
		zoom: MAP_ZOOM,
		maxZoom: MAX_ZOOM,
		doubleClickZoom: false,
		attributionControl: {
			compact: true
		}
	});

	map.addControl(
		new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
		'bottom-right'
	);

	await new Promise<void>((resolve, reject) => {
		const onLoad = () => {
			cleanup();
			resolve();
		};
		const onError = (e: { error?: Error }) => {
			// Style/tile errors can fire after load; only fail if we never loaded.
			if (!map.isStyleLoaded()) {
				cleanup();
				reject(e.error ?? new Error('MapLibre failed to load style'));
			}
		};
		const cleanup = () => {
			map.off('load', onLoad);
			map.off('error', onError);
		};
		map.on('load', onLoad);
		map.on('error', onError);
	});

	initDrawingLayers(map, ROUTE_COLOR);
	bindMapInteractions(map);

	// Drawing tools: only forward to state when we are not mid vertex/trim drag.
	// Vertex/trim mousedown is handled inside bindMapInteractions (registered first).
	map.on('mousedown', (e: MapMouseEvent) => {
		if (isMapFeatureDragging() || !map.dragPan.isEnabled()) return;
		state.handleMapMouseDown(toPointerEvent(e));
	});
	map.on('mousemove', (e: MapMouseEvent) => {
		if (isMapFeatureDragging()) return;
		state.handleMapMouseMove(toPointerEvent(e));
	});
	map.on('mouseup', () => {
		if (isMapFeatureDragging()) return;
		state.handleMapMouseUp();
	});
	map.on('click', (e: MapMouseEvent) => {
		if (consumeSuppressedClick() || isMapFeatureDragging()) return;
		state.handleMapClick(toPointerEvent(e));
	});
	map.on('dblclick', () => state.finishDraft());
	map.on('contextmenu', (e: MapMouseEvent) => {
		e.preventDefault();
		state.finishDraft();
	});

	renderLayers(map, state.shapes, state.draft, undefined, () => false, state.routedPath, false);

	return {
		map,
		teardown: () => {
			resetMapInteractions();
			map.remove();
		}
	};
}
