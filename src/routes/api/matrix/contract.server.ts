import { z } from 'zod';
import { MAX_VIAS, MIN_VIAS } from '#lib/routing/config.js';
import { coordinateSchema, isCoordinateRangeIssue } from '#lib/routing/api/schemas.server.js';
import { matrixSuccessSchema } from '#lib/routing/api/contracts.js';
import {
	apiStatus,
	defineJsonPost,
	jsonRequest,
	jsonResponse,
	providerFailureResponses
} from '../contract.server';

const matrixRequestSchema = z.object(
	{
		coordinates: z
			.array(coordinateSchema, { error: 'Body must include a coordinates array.' })
			.min(MIN_VIAS, { error: `Request needs at least ${MIN_VIAS} coordinates.` })
			.max(MAX_VIAS, { error: `Matrix has too many coordinates (max ${MAX_VIAS}).` })
	},
	{ error: 'Body must include a coordinates array.' }
);

function matrixRequestIssue(issue: z.core.$ZodIssue | undefined): string {
	if (issue?.path[0] === 'coordinates' && typeof issue.path[1] === 'number') {
		const index = issue.path[1];
		return isCoordinateRangeIssue(issue.message)
			? `Coordinate ${index} is out of range.`
			: `Coordinate ${index} is not a valid [lng, lat].`;
	}
	return issue?.message ?? 'Invalid matrix request.';
}

export const { readBody, json, openApiPost } = defineJsonPost({
	operationId: 'getBicycleDistanceMatrix',
	summary: 'Compute a bicycle distance matrix',
	description: 'The same coordinates are used as origins and destinations, in input order.',
	request: jsonRequest(
		matrixRequestSchema,
		{
			coordinates: [
				[21.0122, 52.2297],
				[21.0211, 52.2315]
			]
		},
		matrixRequestIssue
	),
	responses: {
		[apiStatus.ok]: jsonResponse('Distance matrix in meters.', matrixSuccessSchema, {
			ok: true,
			distances: [
				[0, 780],
				[850, 0]
			]
		}),
		...providerFailureResponses({
			badRequest: 'Invalid request or rejected by the routing provider.',
			badGateway: 'The routing provider could not return a usable matrix.'
		})
	}
});
