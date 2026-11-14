import type { Position } from 'geojson';

/** Continuous sketch path extracted from one feature. */
export type GuidePath = {
	/** Open ring for polygons (no duplicate close vertex). */
	points: Position[];
	/** True when the sketch should form a closed loop. */
	closed: boolean;
};

/**
 * Ordered sketch coordinates of one connected component's traversal. Retraced stretches appear
 * once per pass.
 */
export type GuideWalk = {
	points: Position[];
	/** Ascending indexes into `points` that must become vias: walk ends, junctions, dead-end tips. */
	mandatory: number[];
	/** True when the walk returns to its start, so any of its vias may begin the loop. */
	closed: boolean;
};

/** Prepared waypoints for one connected component, kept together for route optimization. */
export type PreparedRouteShape = {
	vias: Position[];
	closed: boolean;
};
