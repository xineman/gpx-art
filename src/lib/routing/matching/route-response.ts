import { z } from 'zod';
import { routeLineStringSchema, routePositionSchema } from '../shared/api-response';

export const routeSuccessSchema = z.object({
	ok: z.literal(true),
	geometry: routeLineStringSchema.describe('Bicycle route matched to the road network.'),
	distanceM: z.number().nonnegative().describe('Route length in meters.'),
	waypoints: z
		.array(routePositionSchema)
		.describe('Retained waypoints in route order, snapped when the provider returns a match.')
});
