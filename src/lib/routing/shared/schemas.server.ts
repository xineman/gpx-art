import { z } from 'zod';

const invalidPosition = 'INVALID_POSITION';
const outOfRange = 'OUT_OF_RANGE';

const longitudeSchema = z
	.number({ error: invalidPosition })
	.min(-180, { error: outOfRange })
	.max(180, { error: outOfRange });

const latitudeSchema = z
	.number({ error: invalidPosition })
	.min(-90, { error: outOfRange })
	.max(90, { error: outOfRange });

/**
 * A map-boundary coordinate. Additional GeoJSON position elements are accepted
 * but discarded so routing providers always receive canonical [lng, lat] pairs.
 */
export const coordinateSchema = z
	.tuple([longitudeSchema, latitudeSchema], z.unknown(), { error: invalidPosition })
	.transform(([lng, lat]) => [lng, lat] as [number, number]);

/**
 * A GeoJSON position used when the complete route geometry must be retained.
 */
export const geoJsonPositionSchema = z.tuple(
	[longitudeSchema, latitudeSchema],
	z.number({ error: invalidPosition }),
	{ error: invalidPosition }
);

export function isCoordinateRangeIssue(message: string): boolean {
	return message === outOfRange;
}
