import { z } from 'zod';
import { MAX_VIAS, MIN_VIAS } from '#lib/config/routing.js';
import { coordinateSchema, isCoordinateRangeIssue } from '#lib/routing/shared/schemas.server.js';
import type { RouteVia } from '#lib/routing/matching/types.js';
import { routeSuccessSchema } from '#lib/routing/matching/route-response.js';
import {
	apiStatus,
	defineJsonPost,
	failureResponse,
	jsonRequest,
	jsonResponse
} from '../contract.server';

function sameLocation(a: RouteVia, b: RouteVia): boolean {
	return a.location[0] === b.location[0] && a.location[1] === b.location[1];
}

function dedupeConsecutiveVias(vias: RouteVia[]): RouteVia[] {
	const distinct: RouteVia[] = [];
	for (const via of vias) {
		const previous = distinct.at(-1);
		if (!previous || !sameLocation(previous, via)) distinct.push(via);
	}
	return distinct;
}

const invalidRadius = 'INVALID_RADIUS';
const invalidBearing = 'INVALID_BEARING';
const invalidBearingRange = 'INVALID_BEARING_RANGE';

const routeViaSchema = z
	.object(
		{
			location: coordinateSchema,
			radiusM: z
				.number({ error: invalidRadius })
				.nonnegative({ error: invalidRadius })
				.optional()
				.describe('Snapping radius in meters.'),
			bearing: z
				.number({ error: invalidBearing })
				.int({ error: invalidBearing })
				.min(0, { error: invalidBearing })
				.max(360, { error: invalidBearing })
				.optional()
				.describe('Heading in degrees.'),
			bearingRange: z
				.number({ error: invalidBearingRange })
				.int({ error: invalidBearingRange })
				.min(0, { error: invalidBearingRange })
				.max(180, { error: invalidBearingRange })
				.optional()
				.describe('Heading tolerance in degrees. Requires bearing.')
		},
		{ error: 'INVALID_POSITION' }
	)
	.superRefine((via, context) => {
		if (via.bearingRange != null && via.bearing == null) {
			context.addIssue({
				code: 'custom',
				path: ['bearingRange'],
				message: invalidBearingRange
			});
		}
	});

const routeRequestSchema = z
	.object(
		{
			vias: z
				.array(routeViaSchema, {
					error: 'Body must include a vias array of waypoint objects.'
				})
				.min(MIN_VIAS, { error: `Request needs at least ${MIN_VIAS} waypoints.` })
				.max(MAX_VIAS, { error: `Route has too many waypoints (max ${MAX_VIAS}).` })
		},
		{ error: 'Body must include a vias array of waypoint objects.' }
	)
	.transform(({ vias }) => ({ vias: dedupeConsecutiveVias(vias) }))
	.refine(({ vias }) => vias.length >= MIN_VIAS, {
		error: 'Need at least two distinct waypoints.',
		path: ['vias']
	});

function waypointError(index: number, message: string): string {
	if (isCoordinateRangeIssue(message)) return `Waypoint ${index} is out of range.`;
	if (message === invalidRadius) return `Waypoint ${index} has an invalid snapping radius.`;
	if (message === invalidBearing) return `Waypoint ${index} has an invalid bearing.`;
	if (message === invalidBearingRange) return `Waypoint ${index} has an invalid bearing range.`;
	return `Waypoint ${index} is not a valid [lng, lat].`;
}

function routeRequestIssue(issue: z.core.$ZodIssue | undefined): string {
	if (issue?.path[0] === 'vias' && typeof issue.path[1] === 'number') {
		return waypointError(issue.path[1], issue.message);
	}
	return issue?.message ?? 'Invalid route request.';
}

export const { readBody, json, openApiPost } = defineJsonPost({
	operationId: 'matchBicycleRoute',
	summary: 'Match waypoints to a bicycle route',
	description:
		'Send waypoints in travel order. Consecutive duplicate positions are removed and at least two distinct positions must remain. The returned waypoints may omit samples that could not be matched.',
	request: jsonRequest(
		routeRequestSchema,
		{
			vias: [{ location: [21.0122, 52.2297] }, { location: [21.0211, 52.2315] }]
		},
		routeRequestIssue
	),
	responses: {
		[apiStatus.ok]: jsonResponse('Matched bicycle route.', routeSuccessSchema, {
			ok: true,
			geometry: {
				type: 'LineString',
				coordinates: [
					[21.0122, 52.2297],
					[21.0164, 52.2304],
					[21.0211, 52.2315]
				]
			},
			distanceM: 780,
			waypoints: [
				[21.0122, 52.2297],
				[21.0211, 52.2315]
			]
		}),
		[apiStatus.badRequest]: failureResponse('Invalid request or no continuous match was found.'),
		[apiStatus.rateLimited]: failureResponse('The routing provider rate limited the request.'),
		[apiStatus.badGateway]: failureResponse('The routing provider returned an error.'),
		[apiStatus.unavailable]: failureResponse('Routing is not configured.')
	}
});
