import { MAX_VIAS, MIN_VIAS } from '$lib/config/routing';
import type { MatrixRequest } from './types';
import { coordinateSchema, isCoordinateRangeIssue } from '../shared/schemas.server';
import { z } from 'zod';

export type ParsedMatrixRequest =
	{ ok: true; request: MatrixRequest } | { ok: false; error: string };

const matrixRequestSchema = z.object(
	{
		coordinates: z
			.array(coordinateSchema, { error: 'Body must include a coordinates array.' })
			.min(MIN_VIAS, { error: `Request needs at least ${MIN_VIAS} coordinates.` })
			.max(MAX_VIAS, { error: `Matrix has too many coordinates (max ${MAX_VIAS}).` })
	},
	{ error: 'Body must include a coordinates array.' }
);

export function parseMatrixRequest(value: unknown): ParsedMatrixRequest {
	const parsed = matrixRequestSchema.safeParse(value);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		if (issue?.path[0] === 'coordinates' && typeof issue.path[1] === 'number') {
			const index = issue.path[1];
			return {
				ok: false,
				error: isCoordinateRangeIssue(issue.message)
					? `Coordinate ${index} is out of range.`
					: `Coordinate ${index} is not a valid [lng, lat].`
			};
		}
		return { ok: false, error: issue?.message ?? 'Invalid matrix request.' };
	}

	return { ok: true, request: parsed.data };
}
