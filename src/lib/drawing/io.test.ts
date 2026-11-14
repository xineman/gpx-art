import { describe, expect, it } from 'vitest';
import { exportFilename, parseDrawingCollection, serializeDrawings } from './io';

const line = {
	type: 'LineString' as const,
	coordinates: [
		[21.0, 52.2],
		[21.01, 52.21]
	]
};

describe('parseDrawingCollection', () => {
	it('accepts a FeatureCollection, normalizes tools, and discards legacy ids', () => {
		const result = parseDrawingCollection({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: { tool: 'polyline', id: 'a1' },
					geometry: line
				},
				{
					type: 'Feature',
					id: 42,
					properties: null,
					geometry: line
				}
			]
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.features).toEqual([
			{ type: 'Feature', properties: { tool: 'polyline' }, geometry: line },
			{ type: 'Feature', properties: { tool: 'imported' }, geometry: line }
		]);
	});

	it('accepts a single Feature', () => {
		const result = parseDrawingCollection({
			type: 'Feature',
			properties: { tool: 'pencil' },
			geometry: line
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.features).toHaveLength(1);
		expect(result.features[0]!.properties.tool).toBe('pencil');
	});

	it('rejects non-geojson roots', () => {
		const result = parseDrawingCollection({ foo: 1 });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/FeatureCollection/i);
	});

	it('rejects features without geometry', () => {
		const result = parseDrawingCollection({
			type: 'FeatureCollection',
			features: [{ type: 'Feature', properties: {}, geometry: null }]
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/geometry/i);
	});

	it('rejects non-objects', () => {
		expect(parseDrawingCollection(null).ok).toBe(false);
		expect(parseDrawingCollection('nope').ok).toBe(false);
	});
});

describe('serializeDrawings', () => {
	it('pretty-prints a FeatureCollection', () => {
		const text = serializeDrawings({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: { tool: 'polyline' },
					geometry: line
				}
			]
		});
		expect(text).toContain('"type": "FeatureCollection"');
		expect(text).toContain('\n');
		expect(JSON.parse(text).features).toHaveLength(1);
	});
});

describe('exportFilename', () => {
	it('uses a local-time YYYY-MM-DD-HH-mm-ss stamp', () => {
		const date = new Date(2026, 6, 15, 9, 4, 7); // month is 0-based
		expect(exportFilename(date)).toBe('gpx-art-sketch-2026-07-15-09-04-07.geojson');
	});
});
