/**
 * Routing API payloads shared by the browser client and the server endpoints.
 *
 * Response schemas document and type the API; the server contracts use them for OpenAPI. Browser
 * code must import from this module with `import type` so Zod stays out of the client bundle.
 */
import type { Position } from 'geojson';
import { z } from 'zod';

export const apiFailureSchema = z.object({
	ok: z.literal(false),
	error: z.string(),
	status: z.number().optional().describe('Provider status, which can differ from the HTTP status.')
});

export type ApiFailure = z.infer<typeof apiFailureSchema>;

export type RouteFailureCode = 'superseded';

/** A failure as seen by the client, including locally produced ones. */
export type RouteFailure = ApiFailure & {
	/** Machine-readable reason for failures handled specially by the client. */
	code?: RouteFailureCode;
};

const routePositionSchema = z.array(z.number()).length(2).describe('Longitude, latitude.');

const routeLineStringSchema = z.object({
	type: z.literal('LineString'),
	coordinates: z.array(routePositionSchema).min(2)
});

// POST /api/route

const sourceViaSchema = z.object({
	location: routePositionSchema,
	radiusM: z.number().optional().describe('Snapping radius in meters.'),
	bearing: z.number().optional().describe('Heading in degrees.'),
	bearingRange: z.number().optional().describe('Heading tolerance in degrees. Requires bearing.')
});

/** One input coordinate with optional road snapping constraints. */
export type RouteVia = z.infer<typeof sourceViaSchema>;

export type RouteRequest = {
	vias: RouteVia[];
};

export const routeSuccessSchema = z.object({
	ok: z.literal(true),
	geometry: routeLineStringSchema.describe('Bicycle route matched to the road network.'),
	distanceM: z.number().nonnegative().describe('Route length in meters.'),
	waypoints: z
		.array(routePositionSchema)
		.describe('Retained waypoints in route order, snapped when the provider returns a match.'),
	sourceVias: z
		.array(sourceViaSchema)
		.optional()
		.describe('Original retained request vias, aligned with waypoints, for safe retries.')
});

export type RouteSuccess = z.infer<typeof routeSuccessSchema>;
export type RouteResponse = RouteSuccess | RouteFailure;

// POST /api/matrix

export type MatrixRequest = {
	coordinates: Position[];
};

export const matrixSuccessSchema = z.object({
	ok: z.literal(true),
	distances: z
		.array(z.array(z.number().nonnegative().nullable()))
		.describe(
			'Square matrix in input order. Entry [i][j] is the bicycle distance in meters from i to j, or null if unavailable.'
		)
});

export type MatrixSuccess = z.infer<typeof matrixSuccessSchema>;
export type MatrixResponse = MatrixSuccess | RouteFailure;

// POST /api/attributes

const roadKindSchema = z.enum(['national', 'voivodeship', 'county', 'municipal', 'other']);

const roadAttributesSchema = z.object({
	roadClass: z.string().nullable(),
	use: z.string().nullable(),
	surface: z.string().nullable(),
	cycleLane: z.string().nullable(),
	bicycleNetwork: z.union([z.string(), z.number()]).nullable(),
	weightedGrade: z.number().nullable(),
	maxUpwardGrade: z.number().nullable(),
	maxDownwardGrade: z.number().nullable(),
	meanElevationM: z.number().nullable()
});

const roadEdgeSchema = roadAttributesSchema.extend({
	id: z.string().describe('Identifier for this road edge.'),
	wayId: z.number().nullable(),
	refs: z.array(z.string()),
	ref: z.string().nullable(),
	displayLabel: z.string(),
	name: z.string().nullable(),
	roadKind: roadKindSchema,
	start: routePositionSchema,
	end: routePositionSchema,
	startM: z.number().nonnegative().describe('Distance from the start of the route, in meters.'),
	endM: z.number().nonnegative().describe('Distance from the start of the route, in meters.'),
	distanceM: z.number().nonnegative(),
	startShapeIndex: z.number().int().nonnegative().describe('Index in the returned geometry.'),
	endShapeIndex: z.number().int().nonnegative().describe('Index in the returned geometry.')
});

const roadSpanSchema = roadEdgeSchema.extend({
	id: z.string().describe('Identifier of the first edge in the span.'),
	wayIds: z.array(z.number()).describe('Distinct way IDs of edges in the span.')
});

export const routeAttributionSuccessSchema = z.object({
	ok: z.literal(true),
	geometry: routeLineStringSchema.describe(
		'Geometry referenced by the edge and span shape indexes.'
	),
	distanceM: z.number().nonnegative(),
	roadEdges: z.array(roadEdgeSchema).describe('Individual road edges in route order.'),
	roadSpans: z.array(roadSpanSchema).describe('Adjacent road edges grouped for display.')
});

export type RouteRoadKind = z.infer<typeof roadKindSchema>;
export type RouteRoadAttributes = z.infer<typeof roadAttributesSchema>;
export type AttributedRouteEdge = z.infer<typeof roadEdgeSchema>;
export type RouteRoadSpan = z.infer<typeof roadSpanSchema>;
export type RouteAttributionSuccess = z.infer<typeof routeAttributionSuccessSchema>;
export type RouteAttributionResponse = RouteAttributionSuccess | RouteFailure;
