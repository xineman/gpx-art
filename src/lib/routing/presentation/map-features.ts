import type { Feature, FeatureCollection, LineString, Position } from 'geojson';
import type { RouteRoadSpan } from '../attribution/types';
import type { RouteDetour } from '../refinement/detours';
import type { WaypointRefinementAction } from '../refinement/types';

type WaypointRole = 'start' | 'via' | 'end';

export type RouteMapWaypoint = {
	coordinates: Position;
	candidate: boolean;
	action: WaypointRefinementAction;
};

export type RouteMapData = {
	routeGeometry: LineString | null;
	waypoints: RouteMapWaypoint[];
	detours: RouteDetour[];
	activeRoadSpan: Pick<RouteRoadSpan, 'roadKind' | 'startShapeIndex' | 'endShapeIndex'> | null;
	interactive: boolean;
};

function waypointRole(index: number, total: number): WaypointRole {
	if (index === 0) return 'start';
	if (index === total - 1) return 'end';
	return 'via';
}

function waypointFeatures(waypoints: RouteMapWaypoint[], interactive: boolean): Feature[] {
	const total = waypoints.length;
	return waypoints.map(({ coordinates, candidate, action }, index) => ({
		type: 'Feature' as const,
		properties: {
			kind: 'waypoint',
			index,
			role: waypointRole(index, total),
			candidate,
			action,
			interactive
		},
		geometry: { type: 'Point' as const, coordinates }
	}));
}

export function buildRouteMapFeatures({
	routeGeometry,
	waypoints,
	detours,
	activeRoadSpan,
	interactive
}: RouteMapData): FeatureCollection {
	const features: Feature[] = [];
	if (routeGeometry) {
		features.push({
			type: 'Feature',
			properties: { kind: 'route' },
			geometry: routeGeometry
		});
	}

	if (
		routeGeometry &&
		activeRoadSpan &&
		activeRoadSpan.startShapeIndex >= 0 &&
		activeRoadSpan.endShapeIndex < routeGeometry.coordinates.length &&
		activeRoadSpan.endShapeIndex >= activeRoadSpan.startShapeIndex
	) {
		features.push({
			type: 'Feature',
			properties: { kind: 'road-highlight', roadKind: activeRoadSpan.roadKind },
			geometry: {
				type: 'LineString',
				coordinates: routeGeometry.coordinates.slice(
					activeRoadSpan.startShapeIndex,
					activeRoadSpan.endShapeIndex + 1
				)
			}
		});
	}

	for (const detour of detours) {
		features.push({
			type: 'Feature',
			properties: {
				kind: 'detour',
				action: 'move',
				routeDistanceM: detour.routeDistanceM,
				returnDistanceM: detour.returnDistanceM,
				excessDistanceM: detour.excessDistanceM
			},
			geometry: detour.geometry
		});
	}

	features.push(...waypointFeatures(waypoints, interactive));
	return { type: 'FeatureCollection', features };
}
