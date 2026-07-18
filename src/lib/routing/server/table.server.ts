import { MAX_VIAS, MIN_VIAS } from '$lib/config/routing';
import type { TableRequest } from '../types';
import { inCoordinateRange, isFinitePosition, isRecord } from './validation.server';

export type ParsedTableRequest = { ok: true; request: TableRequest } | { ok: false; error: string };

export function parseTableRequest(value: unknown): ParsedTableRequest {
	if (!isRecord(value) || !Array.isArray(value.coordinates)) {
		return { ok: false, error: 'Body must include a coordinates array.' };
	}
	if (value.coordinates.length < MIN_VIAS) {
		return { ok: false, error: `Request needs at least ${MIN_VIAS} coordinates.` };
	}
	if (value.coordinates.length > MAX_VIAS) {
		return { ok: false, error: `Table has too many coordinates (max ${MAX_VIAS}).` };
	}

	const coordinates: TableRequest['coordinates'] = [];
	for (let index = 0; index < value.coordinates.length; index++) {
		const rawCoordinate = value.coordinates[index];
		if (!isFinitePosition(rawCoordinate)) {
			return { ok: false, error: `Coordinate ${index} is not a valid [lng, lat].` };
		}
		const coordinate: [number, number] = [rawCoordinate[0], rawCoordinate[1]];
		if (!inCoordinateRange(coordinate)) {
			return { ok: false, error: `Coordinate ${index} is out of range.` };
		}
		coordinates.push(coordinate);
	}

	return { ok: true, request: { coordinates } };
}
