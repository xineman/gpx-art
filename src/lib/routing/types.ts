import type { LineString, Position } from 'geojson';

/** Optional road-snapping constraints for one input coordinate. */
export type RouteVia = {
	location: Position;
	radiusM?: number;
	bearing?: number;
	bearingRange?: number;
};

export type RouteRequest = {
	vias: RouteVia[];
	continueStraight?: boolean;
};

/** Continuous sketch path extracted from one feature. */
export type GuidePath = {
	/** Open ring for polygons (no duplicate close vertex). */
	points: Position[];
	/** True when the sketch should form a closed loop. */
	closed: boolean;
};

export type RouteSuccess = {
	ok: true;
	geometry: LineString;
	distanceM: number;
	/** Map-matched input positions, in route order. */
	waypoints: Position[];
};

export type RouteFailure = {
	ok: false;
	error: string;
};

export type RouteResponse = RouteSuccess | RouteFailure;
