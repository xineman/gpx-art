import type { Position } from 'geojson';

/** Continuous sketch path extracted from one feature. */
export type GuidePath = {
	/** Open ring for polygons (no duplicate close vertex). */
	points: Position[];
	/** True when the sketch should form a closed loop. */
	closed: boolean;
};

/** Prepared waypoints for one sketch feature, kept together for route optimization. */
export type PreparedRouteShape = {
	vias: Position[];
	closed: boolean;
};
