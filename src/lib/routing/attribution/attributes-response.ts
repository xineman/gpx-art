import { z } from 'zod';
import { routeLineStringSchema, routePositionSchema } from '../shared/api-response';

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
