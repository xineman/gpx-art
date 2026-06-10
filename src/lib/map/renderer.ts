import type * as Leaflet from 'leaflet';
import { closeShape, toLatLngs } from '$lib/geometry/point';
import type { Shape } from '$lib/types/sketch';

type L = typeof import('leaflet');

export function renderLayers(
	L: L | undefined,
	drawingLayer: Leaflet.LayerGroup | undefined,
	shapes: Shape[],
	draft: Shape | null
) {
	if (!L || !drawingLayer) return;

	drawingLayer.clearLayers();

	for (const shape of shapes) {
		addShapeLayer(L, drawingLayer, shape, false);
	}

	if (draft) {
		addShapeLayer(L, drawingLayer, draft, true);
	}
}

function addShapeLayer(L: L, drawingLayer: Leaflet.LayerGroup, shape: Shape, isDraft: boolean) {
	if (shape.points.length === 0) return;

	const points =
		shape.type === 'polygon' || shape.type === 'rectangle'
			? closeShape(shape.points)
			: shape.points;
	const common = {
		interactive: false,
		lineCap: 'round' as const,
		lineJoin: 'round' as const,
		opacity: isDraft ? 0.92 : 0.72,
		weight: isDraft ? 4 : 3
	};

	if (shape.type === 'polygon' || shape.type === 'rectangle') {
		L.polygon(toLatLngs(points), {
			...common,
			color: isDraft ? '#f26b3a' : '#2c2924',
			fillColor: isDraft ? '#f26b3a' : '#e6b84a',
			fillOpacity: isDraft ? 0.15 : 0.1
		}).addTo(drawingLayer);
	} else {
		L.polyline(toLatLngs(points), {
			...common,
			color: isDraft ? '#f26b3a' : '#2c2924'
		}).addTo(drawingLayer);
	}

	if (isDraft && shape.points.length > 0) {
		for (const point of shape.points) {
			L.circleMarker([point.lat, point.lng], {
				color: '#f26b3a',
				fillColor: '#fff7df',
				fillOpacity: 1,
				radius: 4,
				weight: 2
			}).addTo(drawingLayer);
		}
	}
}
