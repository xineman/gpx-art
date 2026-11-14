import type { Position } from 'geojson';
import type { z } from 'zod';
import type { RouteFailure } from '../shared/failure';
import type { routeSuccessSchema } from './route-response';

/** One input coordinate with optional road snapping constraints. */
export type RouteVia = {
	location: Position;
	/** Snapping radius in meters. */
	radiusM?: number;
	/** Heading in degrees. */
	bearing?: number;
	/** Heading tolerance in degrees; requires `bearing`. */
	bearingRange?: number;
};

export type RouteRequest = {
	vias: RouteVia[];
};

export type RouteSuccess = z.infer<typeof routeSuccessSchema>;

export type RouteResponse = RouteSuccess | RouteFailure;
