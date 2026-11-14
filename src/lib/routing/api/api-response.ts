import { z } from 'zod';

export const apiFailureSchema = z.object({
	ok: z.literal(false),
	error: z.string(),
	status: z.number().optional().describe('Provider status, which can differ from the HTTP status.')
});

export type ApiFailure = z.infer<typeof apiFailureSchema>;

export const routePositionSchema = z.array(z.number()).length(2).describe('Longitude, latitude.');

export const routeLineStringSchema = z.object({
	type: z.literal('LineString'),
	coordinates: z.array(routePositionSchema).min(2)
});
