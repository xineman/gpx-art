import type { LineString, Position } from 'geojson';

/** Optional OSRM snapping constraints for one input coordinate. */
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

/** Prepared waypoints for one sketch feature, kept together for route optimization. */
export type PreparedRouteShape = {
	vias: Position[];
	closed: boolean;
};

export type TableRequest = {
	coordinates: Position[];
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
	/** OSRM-snapped input positions, in route order. */
	waypoints: Position[];
};

export type RouteFailure = {
	ok: false;
	error: string;
};

export type RouteResponse = RouteSuccess | RouteFailure;

export type TableSuccess = {
	ok: true;
	distances: (number | null)[][];
};

export type TableResponse = TableSuccess | RouteFailure;

/** OSRM route service success body (subset we read). */
export type OsrmRouteResponse = {
	code: string;
	message?: string;
	waypoints?: {
		location?: Position;
	}[];
	routes?: {
		distance?: number;
		geometry?: LineString | string;
	}[];
};

/** OSRM Table service success body (subset we read). */
export type OsrmTableResponse = {
	code: string;
	message?: string;
	distances?: (number | null)[][];
};
