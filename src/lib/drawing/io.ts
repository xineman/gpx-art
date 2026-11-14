import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { DrawingFeature } from './types';

export type ParseDrawingsResult =
	{ ok: true; features: DrawingFeature[] } | { ok: false; error: string };

const DEFAULT_TOOL = 'imported';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGeometry(value: unknown): value is Geometry {
	if (!isRecord(value) || typeof value.type !== 'string') return false;
	// All GeoJSON geometry types carry coordinates (GeometryCollection uses geometries).
	if (value.type === 'GeometryCollection') {
		return Array.isArray(value.geometries);
	}
	return 'coordinates' in value;
}

function normalizeFeature(raw: unknown, index: number): DrawingFeature | { error: string } {
	if (!isRecord(raw) || raw.type !== 'Feature') {
		return { error: `Feature at index ${index} is not a GeoJSON Feature.` };
	}
	if (!isGeometry(raw.geometry)) {
		return { error: `Feature at index ${index} is missing a valid geometry.` };
	}

	const props = isRecord(raw.properties) ? raw.properties : {};
	const tool =
		typeof props.tool === 'string' && props.tool.trim() ? props.tool.trim() : DEFAULT_TOOL;

	const feature: DrawingFeature = {
		type: 'Feature',
		properties: { tool },
		geometry: raw.geometry
	};
	return feature;
}

/**
 * Parse unknown JSON into drawing features.
 * Accepts a FeatureCollection or a single Feature.
 */
export function parseDrawingCollection(raw: unknown): ParseDrawingsResult {
	if (!isRecord(raw)) {
		return {
			ok: false,
			error: 'Couldn’t read that file — use a GeoJSON FeatureCollection.'
		};
	}

	if (raw.type === 'Feature') {
		const normalized = normalizeFeature(raw, 0);
		if ('error' in normalized) {
			return { ok: false, error: normalized.error };
		}
		return { ok: true, features: [normalized] };
	}

	if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
		return {
			ok: false,
			error: 'Couldn’t read that file — use a GeoJSON FeatureCollection.'
		};
	}

	const features: DrawingFeature[] = [];
	for (let i = 0; i < raw.features.length; i++) {
		const normalized = normalizeFeature(raw.features[i], i);
		if ('error' in normalized) {
			return { ok: false, error: normalized.error };
		}
		features.push(normalized);
	}

	return { ok: true, features };
}

/** Pretty-print a FeatureCollection for download. */
export function serializeDrawings(collection: FeatureCollection): string {
	return JSON.stringify(collection, null, 2);
}

/**
 * Local-time export filename: `gpx-art-sketch-YYYY-MM-DD-HH-mm-ss.geojson`.
 */
export function exportFilename(date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds())
	].join('-');
	return `gpx-art-sketch-${stamp}.geojson`;
}

/** Type helper for tests / callers that already hold features. */
export type { Feature, FeatureCollection, DrawingFeature };
