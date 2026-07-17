import type { LineString, Position } from 'geojson';

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

/** OSRM route service success body (subset we read). */
export type OsrmRouteResponse = {
	code: string;
	message?: string;
	waypoints?: Array<{
		location?: Position;
	}>;
	routes?: Array<{
		distance?: number;
		geometry?: LineString | string;
	}>;
};
