import { z } from 'zod';
import { geoJsonPositionSchema } from '#lib/routing/shared/schemas.server.js';
import {
	routeAttributionSuccessSchema,
	type AttributedRouteEdge
} from '#lib/routing/attribution/attributes-response.js';
import { apiFailureSchema } from '#lib/routing/shared/api-response.js';
import { apiStatus, defineJsonPost, jsonRequest, jsonResponse } from '../contract.server';

const MAX_ROUTE_SHAPE_POINTS = 100_000;
const missingGeometry = 'Body must include a route geometry.';
const invalidGeometry = 'Route geometry must be a LineString.';

const lineStringSchema = z.object(
	{
		type: z.literal('LineString', { error: invalidGeometry }),
		coordinates: z
			.array(geoJsonPositionSchema, { error: invalidGeometry })
			.min(2, { error: 'Route geometry has an invalid number of points.' })
			.max(MAX_ROUTE_SHAPE_POINTS, {
				error: 'Route geometry has an invalid number of points.'
			})
	},
	{ error: (issue) => (issue.input === undefined ? missingGeometry : invalidGeometry) }
);

const routeGeometrySchema = z.object({ geometry: lineStringSchema }, { error: missingGeometry });

function routeGeometryIssue(issue: z.core.$ZodIssue | undefined): string {
	if (issue?.path[1] === 'coordinates' && typeof issue.path[2] === 'number') {
		return 'Route geometry contains an invalid coordinate.';
	}
	return issue?.message ?? 'Invalid route geometry.';
}

const attributesFailureSchema = apiFailureSchema.omit({ status: true });

const geometry = {
	type: 'LineString',
	coordinates: [
		[21.0122, 52.2297],
		[21.0164, 52.2304],
		[21.0211, 52.2315]
	]
} satisfies z.input<typeof routeGeometrySchema>['geometry'];
const edge: AttributedRouteEdge = {
	id: '100',
	wayId: 123,
	refs: [],
	ref: null,
	displayLabel: 'Cycleway',
	name: null,
	roadKind: 'other',
	roadClass: null,
	use: 'cycleway',
	surface: 'paved',
	cycleLane: null,
	bicycleNetwork: null,
	weightedGrade: null,
	maxUpwardGrade: null,
	maxDownwardGrade: null,
	meanElevationM: null,
	start: geometry.coordinates[0],
	end: geometry.coordinates[2],
	startM: 0,
	endM: 780,
	distanceM: 780,
	startShapeIndex: 0,
	endShapeIndex: 2
};

export const { readBody, json, openApiPost } = defineJsonPost({
	operationId: 'getRouteAttributes',
	summary: 'Get road details for a route',
	description:
		'Send the LineString returned by the route endpoint. Use the geometry in this response when looking up edge or span shape indexes.',
	request: jsonRequest(routeGeometrySchema, { geometry }, routeGeometryIssue),
	responses: {
		[apiStatus.ok]: jsonResponse('Road edges and grouped spans.', routeAttributionSuccessSchema, {
			ok: true,
			geometry,
			distanceM: edge.endM,
			roadEdges: [edge],
			roadSpans: [{ ...edge, wayIds: [123] }]
		}),
		[apiStatus.badRequest]: jsonResponse(
			'Invalid request or road details could not be matched.',
			attributesFailureSchema
		),
		[apiStatus.badGateway]: jsonResponse('Routing server unavailable.', attributesFailureSchema),
		[apiStatus.unavailable]: jsonResponse('Routing is not configured.', attributesFailureSchema)
	}
});
