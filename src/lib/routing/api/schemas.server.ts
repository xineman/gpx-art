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

const coordinateComponents = [longitudeSchema, latitudeSchema] as const;

/**
 * A map-boundary coordinate. Additional GeoJSON position elements are accepted
 * but discarded so routing providers always receive canonical [lng, lat] pairs.
 */
export const coordinateSchema = z
	.tuple(coordinateComponents, z.unknown(), { error: invalidPosition })
	// Zod's JSON Schema export needs the explicit minimum for a tuple with rest items.
	.check(z.minLength(coordinateComponents.length))
	.meta({ description: 'Longitude, latitude. Additional elements are ignored.' })
	.transform(([lng, lat]) => [lng, lat] as [number, number]);

/**
 * A GeoJSON position used when the complete route geometry must be retained.
 */
export const geoJsonPositionSchema = z
	.tuple(coordinateComponents, z.number({ error: invalidPosition }), { error: invalidPosition })
	.check(z.minLength(coordinateComponents.length))
	.describe('Longitude, latitude, and optional numeric position elements such as elevation.');

export function isCoordinateRangeIssue(message: string): boolean {
	return message === outOfRange;
}
