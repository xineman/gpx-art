import type * as Leaflet from 'leaflet';
import type { Point } from '$lib/types/sketch';
import type { RouteDebugBatch } from '$lib/routing/batchPlan';

type L = typeof import('leaflet');

// Cream fill for the point markers, matching the existing vertex handle
// style in renderer.ts (cream panel backgrounds) so the debug overlay reads
// as part of the same visual vocabulary. Stroke is the batch's color.
const DEBUG_POINT_FILL = '#fff7df';

// Paint each batch as a polyline through its points plus a circleMarker at
// each point. Markers are non-interactive so they never steal click events
// from the route or drawing layer underneath.
//
// Caller is responsible for `layer.clearLayers()` before invoking this — we
// don't auto-clear so a no-op render path stays a no-op (the existing
// renderLayers convention).
export function renderRouteDebug(
	L: L,
	layer: Leaflet.LayerGroup,
	batches: readonly RouteDebugBatch[]
) {
	for (const batch of batches) {
		if (batch.points.length === 0) continue;

		if (batch.points.length >= 2) {
			L.polyline(toLatLngs(batch.points), {
				color: batch.color,
				weight: 4,
				opacity: 0.85,
				lineCap: 'round',
				lineJoin: 'round',
				interactive: false
			}).addTo(layer);
		}

		for (const point of batch.points) {
			L.circleMarker([point.lat, point.lng], {
				color: batch.color,
				fillColor: DEBUG_POINT_FILL,
				fillOpacity: 1,
				radius: 5,
				weight: 2,
				interactive: false
			}).addTo(layer);
		}
	}
}

function toLatLngs(points: Point[]): [number, number][] {
	return points.map((p) => [p.lat, p.lng]);
}
