import type { Feature, FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { emptyFeatureCollection } from './coords';

/** GeoJSON source ids — fixed for the life of the map. */
export const SOURCE = {
	sketchFills: 'sketch-fills',
	sketchLines: 'sketch-lines',
	sketchVertices: 'sketch-vertices',
	routeLine: 'route-line',
	routeTrimSoft: 'route-trim-soft',
	routeTrimDash: 'route-trim-dash',
	routeEndpoints: 'route-endpoints',
	routeChevrons: 'route-chevrons',
	routeHandles: 'route-handles',
	routeDebug: 'route-debug'
} as const;

/** Layer ids painted above the basemap style. */
export const LAYER = {
	sketchFills: 'sketch-fills-fill',
	sketchLines: 'sketch-lines-line',
	sketchVerticesHit: 'sketch-vertices-hit',
	sketchVertices: 'sketch-vertices-circle',
	routeLine: 'route-line-line',
	routeTrimSoft: 'route-trim-soft-line',
	routeTrimDash: 'route-trim-dash-line',
	routeEndpoints: 'route-endpoints-circle',
	routeChevronsUnder: 'route-chevrons-under',
	routeChevrons: 'route-chevrons-line',
	routeHandlesHit: 'route-handles-hit',
	routeHandles: 'route-handles-circle',
	routeDebugLine: 'route-debug-line',
	routeDebugPoint: 'route-debug-point'
} as const;

/** Layers that accept pointer hits for vertex / trim drag. */
export const INTERACTIVE_LAYERS = [
	LAYER.sketchVerticesHit,
	LAYER.sketchVertices,
	LAYER.routeHandlesHit,
	LAYER.routeHandles
] as const;

const DRAFT_ORANGE = '#f26b3a';
const SKETCH_INK = '#2c2924';
const SKETCH_FILL = '#e6b84a';
const CREAM = '#fff7df';

function addEmptyGeoJsonSource(map: MapLibreMap, id: string) {
	map.addSource(id, {
		type: 'geojson',
		data: emptyFeatureCollection()
	});
}

/**
 * Register empty sketch/route sources and layers once after the style loads.
 * Subsequent updates only call `setData` on these sources.
 */
export function initDrawingLayers(map: MapLibreMap, routeColor: string) {
	const sources = Object.values(SOURCE);
	for (const id of sources) {
		addEmptyGeoJsonSource(map, id);
	}

	// Sketch fills (polygons / rectangles)
	map.addLayer({
		id: LAYER.sketchFills,
		type: 'fill',
		source: SOURCE.sketchFills,
		paint: {
			// isDraft stored as 0|1 (GeoJSON props are more reliable as numbers)
			'fill-color': ['case', ['==', ['get', 'isDraft'], 1], DRAFT_ORANGE, SKETCH_FILL],
			'fill-opacity': ['case', ['==', ['get', 'isDraft'], 1], 0.15, 0.1]
		}
	});

	// Sketch lines
	map.addLayer({
		id: LAYER.sketchLines,
		type: 'line',
		source: SOURCE.sketchLines,
		layout: {
			'line-cap': 'round',
			'line-join': 'round'
		},
		paint: {
			'line-color': ['case', ['==', ['get', 'isDraft'], 1], DRAFT_ORANGE, SKETCH_INK],
			'line-width': ['case', ['==', ['get', 'isDraft'], 1], 4, 3],
			'line-opacity': ['case', ['==', ['get', 'isDraft'], 1], 0.92, 0.72]
		}
	});

	// Larger invisible hit target for vertices
	map.addLayer({
		id: LAYER.sketchVerticesHit,
		type: 'circle',
		source: SOURCE.sketchVertices,
		paint: {
			'circle-radius': 14,
			'circle-color': '#000',
			'circle-opacity': 0
		}
	});

	map.addLayer({
		id: LAYER.sketchVertices,
		type: 'circle',
		source: SOURCE.sketchVertices,
		paint: {
			'circle-radius': 4,
			'circle-color': CREAM,
			'circle-stroke-color': DRAFT_ORANGE,
			'circle-stroke-width': 2
		}
	});

	// Route
	map.addLayer({
		id: LAYER.routeLine,
		type: 'line',
		source: SOURCE.routeLine,
		layout: {
			'line-cap': 'round',
			'line-join': 'round'
		},
		paint: {
			'line-color': routeColor,
			'line-width': 5,
			'line-opacity': 0.9
		}
	});

	map.addLayer({
		id: LAYER.routeTrimSoft,
		type: 'line',
		source: SOURCE.routeTrimSoft,
		layout: {
			'line-cap': 'round',
			'line-join': 'round'
		},
		paint: {
			'line-color': '#f6c5b8',
			'line-width': 12,
			'line-opacity': 0.55
		}
	});

	map.addLayer({
		id: LAYER.routeTrimDash,
		type: 'line',
		source: SOURCE.routeTrimDash,
		layout: {
			'line-cap': 'butt',
			'line-join': 'round'
		},
		paint: {
			'line-color': '#c8412c',
			'line-width': 5,
			'line-opacity': 0.95,
			'line-dasharray': [1.4, 1.2]
		}
	});

	map.addLayer({
		id: LAYER.routeEndpoints,
		type: 'circle',
		source: SOURCE.routeEndpoints,
		paint: {
			'circle-radius': 6,
			'circle-color': ['get', 'fill'],
			'circle-stroke-color': ['get', 'stroke'],
			'circle-stroke-width': ['get', 'strokeWidth']
		}
	});

	map.addLayer({
		id: LAYER.routeChevronsUnder,
		type: 'line',
		source: SOURCE.routeChevrons,
		layout: {
			'line-cap': 'round',
			'line-join': 'round'
		},
		paint: {
			'line-color': CREAM,
			'line-width': 4.5,
			'line-opacity': 0.85
		}
	});

	map.addLayer({
		id: LAYER.routeChevrons,
		type: 'line',
		source: SOURCE.routeChevrons,
		layout: {
			'line-cap': 'round',
			'line-join': 'round'
		},
		paint: {
			'line-color': routeColor,
			'line-width': 2.5,
			'line-opacity': 0.95
		}
	});

	map.addLayer({
		id: LAYER.routeHandlesHit,
		type: 'circle',
		source: SOURCE.routeHandles,
		paint: {
			'circle-radius': 16,
			'circle-color': '#000',
			'circle-opacity': 0
		}
	});

	map.addLayer({
		id: LAYER.routeHandles,
		type: 'circle',
		source: SOURCE.routeHandles,
		paint: {
			'circle-radius': 7,
			'circle-color': CREAM,
			'circle-stroke-color': '#c8412c',
			'circle-stroke-width': 3
		}
	});

	// Debug overlay (batch waypoints)
	map.addLayer({
		id: LAYER.routeDebugLine,
		type: 'line',
		source: SOURCE.routeDebug,
		filter: ['==', ['geometry-type'], 'LineString'],
		layout: {
			'line-cap': 'round',
			'line-join': 'round'
		},
		paint: {
			'line-color': ['get', 'color'],
			'line-width': 4,
			'line-opacity': 0.85
		}
	});

	map.addLayer({
		id: LAYER.routeDebugPoint,
		type: 'circle',
		source: SOURCE.routeDebug,
		filter: ['==', ['geometry-type'], 'Point'],
		paint: {
			'circle-radius': 5,
			'circle-color': CREAM,
			'circle-stroke-color': ['get', 'color'],
			'circle-stroke-width': 2
		}
	});
}

export function setSourceData(
	map: MapLibreMap,
	sourceId: string,
	data: FeatureCollection | Feature
) {
	const source = map.getSource(sourceId) as GeoJSONSource | undefined;
	if (source) {
		source.setData(data);
	}
}
