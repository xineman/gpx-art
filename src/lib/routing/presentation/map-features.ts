import type { Feature, FeatureCollection, LineString, Position } from 'geojson';
import type { RouteRoadSpan } from '../attribution/types';
import type { WaypointMoveProposal } from '../refinement/plan';
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
	moveProposals: WaypointMoveProposal[];
	highlightedMoveWaypointIndex: number | null;
	activeRoadSpan: Pick<RouteRoadSpan, 'roadKind' | 'startShapeIndex' | 'endShapeIndex'> | null;
	interactive: boolean;
};

function waypointRole(index: number, total: number): WaypointRole {
	if (index === 0) return 'start';
	if (index === total - 1) return 'end';
	return 'via';
}

function waypointFeatures(
	waypoints: RouteMapWaypoint[],
	interactive: boolean,
	highlightedMoveWaypointIndex: number | null
): Feature[] {
	const total = waypoints.length;
	return waypoints.map(({ coordinates, candidate, action }, index) => ({
		type: 'Feature' as const,
		properties: {
			kind: 'waypoint',
			index,
			role: waypointRole(index, total),
			candidate,
			action,
			activeMove: index === highlightedMoveWaypointIndex,
			interactive
		},
		geometry: { type: 'Point' as const, coordinates }
	}));
}

export function buildRouteMapFeatures({
	routeGeometry,
	waypoints,
	moveProposals,
	highlightedMoveWaypointIndex,
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

	for (const { waypointIndex, detour } of moveProposals) {
		features.push({
			type: 'Feature',
			properties: {
				kind: 'detour',
				action: 'move',
				waypointIndex,
				activeMove: waypointIndex === highlightedMoveWaypointIndex,
				routeDistanceM: detour.routeDistanceM,
				returnDistanceM: detour.returnDistanceM,
				excessDistanceM: detour.excessDistanceM
			},
			geometry: detour.geometry
		});
	}

	for (const { waypointIndex, from, to } of moveProposals) {
		const activeMove = waypointIndex === highlightedMoveWaypointIndex;
		features.push({
			type: 'Feature',
			properties: { kind: 'move-link', waypointIndex, activeMove },
			geometry: { type: 'LineString', coordinates: [from, to] }
		});
		features.push({
			type: 'Feature',
			properties: { kind: 'move-target', waypointIndex, activeMove },
			geometry: { type: 'Point', coordinates: to }
		});
	}

	features.push(...waypointFeatures(waypoints, interactive, highlightedMoveWaypointIndex));
	return { type: 'FeatureCollection', features };
}
