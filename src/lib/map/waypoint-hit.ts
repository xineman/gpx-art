import type { Map as MaplibreMap, PointLike } from 'maplibre-gl';
import { ROUTE_WAYPOINTS } from '$lib/drawing/layers';

export const ROUTE_WAYPOINT_HIT_RADIUS_PX = 20;

function screenCoordinates(point: PointLike): [number, number] {
	return Array.isArray(point) ? point : [point.x, point.y];
}

/** Return the nearest rendered route waypoint within the padded screen hit area. */
export function routeWaypointAtPoint(
	map: MaplibreMap,
	point: PointLike,
	radius = ROUTE_WAYPOINT_HIT_RADIUS_PX
): number | null {
	if (!map.getLayer(ROUTE_WAYPOINTS)) return null;
	const [x, y] = screenCoordinates(point);
	const features = map.queryRenderedFeatures(
		[
			[x - radius, y - radius],
			[x + radius, y + radius]
		],
		{ layers: [ROUTE_WAYPOINTS] }
	);

	let nearestIndex: number | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const feature of features) {
		if (feature.properties.interactive !== true) continue;
		if (feature.geometry.type !== 'Point') continue;
		const index = feature.properties.index;
		if (typeof index !== 'number') continue;
		const projected = map.project(feature.geometry.coordinates as [number, number]);
		const distance = Math.hypot(projected.x - x, projected.y - y);
		if (distance <= radius && distance < nearestDistance) {
			nearestIndex = index;
			nearestDistance = distance;
		}
	}
	return nearestIndex;
}
