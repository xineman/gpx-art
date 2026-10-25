import { MAX_VIAS, MIN_VIAS } from '#lib/config/routing.js';
import type { RouteRequest, RouteResponse, RouteVia } from './types';
import { fetchValhallaTrace } from '../providers/valhalla/trace.server';
import type { ValhallaConfig } from '../providers/valhalla/types.server';
import { coordinateSchema, isCoordinateRangeIssue } from '../shared/schemas.server';
import { z } from 'zod';

export type GenerateRouteOptions = {
	valhalla: ValhallaConfig;
};

export type ParsedRouteRequest = { ok: true; request: RouteRequest } | { ok: false; error: string };

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
			radiusM: z.number({ error: invalidRadius }).nonnegative({ error: invalidRadius }).optional(),
			bearing: z
				.number({ error: invalidBearing })
				.int({ error: invalidBearing })
				.min(0, { error: invalidBearing })
				.max(360, { error: invalidBearing })
				.optional(),
			bearingRange: z
				.number({ error: invalidBearingRange })
				.int({ error: invalidBearingRange })
				.min(0, { error: invalidBearingRange })
				.max(180, { error: invalidBearingRange })
				.optional()
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

/**
 * Parse and sanitize the public route API payload before it reaches Valhalla.
 */
export function parseRouteRequest(value: unknown): ParsedRouteRequest {
	const parsed = routeRequestSchema.safeParse(value);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		if (issue?.path[0] === 'vias' && typeof issue.path[1] === 'number') {
			return { ok: false, error: waypointError(issue.path[1], issue.message) };
		}
		return { ok: false, error: issue?.message ?? 'Invalid route request.' };
	}

	return { ok: true, request: parsed.data };
}

/**
 * Server pipeline: ordered prepared vias → one continuous Valhalla map match.
 */
export async function generateRoute(
	request: RouteRequest,
	options: GenerateRouteOptions
): Promise<RouteResponse> {
	const matched = await fetchValhallaTrace(request, options.valhalla);
	if (!matched.ok) return matched;

	return {
		ok: true,
		geometry: matched.geometry,
		distanceM: matched.distanceM,
		waypoints: matched.waypoints
	};
}
