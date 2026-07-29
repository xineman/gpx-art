import type { LineString } from 'geojson';
import { geoJsonPositionSchema } from '../shared/schemas.server';
import { z } from 'zod';

const MAX_ROUTE_SHAPE_POINTS = 100_000;

export type ParsedRouteGeometry = { ok: true; geometry: LineString } | { ok: false; error: string };

const lineStringSchema = z.object(
	{
		type: z.literal('LineString', { error: 'Route geometry must be a LineString.' }),
		coordinates: z
			.array(geoJsonPositionSchema, { error: 'Route geometry must be a LineString.' })
			.min(2, { error: 'Route geometry has an invalid number of points.' })
			.max(MAX_ROUTE_SHAPE_POINTS, {
				error: 'Route geometry has an invalid number of points.'
			})
	},
	{ error: 'Route geometry must be a LineString.' }
);

const routeGeometrySchema = z
	.object(
		{
			geometry: z.custom<unknown>((geometry) => geometry !== undefined, {
				error: 'Body must include a route geometry.'
			})
		},
		{ error: 'Body must include a route geometry.' }
	)
	.transform(({ geometry }) => geometry)
	.pipe(lineStringSchema);

export function parseRouteGeometry(value: unknown): ParsedRouteGeometry {
	const parsed = routeGeometrySchema.safeParse(value);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		if (issue?.path[0] === 'coordinates' && typeof issue.path[1] === 'number') {
			return { ok: false, error: 'Route geometry contains an invalid coordinate.' };
		}
		return { ok: false, error: issue?.message ?? 'Invalid route geometry.' };
	}
	return { ok: true, geometry: parsed.data };
}
