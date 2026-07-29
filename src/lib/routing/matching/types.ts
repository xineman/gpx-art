import type { LineString, Position } from 'geojson';
import type { RouteFailure } from '../shared/failure';

/** Optional road-snapping constraints for one input coordinate. */
export type RouteVia = {
	location: Position;
	radiusM?: number;
	bearing?: number;
	bearingRange?: number;
};

export type RouteRequest = {
	vias: RouteVia[];
};

export type RouteSuccess = {
	ok: true;
	geometry: LineString;
	distanceM: number;
	/** Map-matched input positions, in route order. */
	waypoints: Position[];
};

export type RouteResponse = RouteSuccess | RouteFailure;
