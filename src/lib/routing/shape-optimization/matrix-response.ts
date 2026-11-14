import { z } from 'zod';
import type { ApiFailure } from '../shared/api-response';

export const matrixSuccessSchema = z.object({
	ok: z.literal(true),
	distances: z
		.array(z.array(z.number().nonnegative().nullable()))
		.describe(
			'Square matrix in input order. Entry [i][j] is the bicycle distance in meters from i to j, or null if unavailable.'
		)
});

export type MatrixSuccess = z.infer<typeof matrixSuccessSchema>;
export type MatrixApiResponse = MatrixSuccess | ApiFailure;
