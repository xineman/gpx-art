import { describe, expect, it } from 'vitest';
import type { Feature } from 'geojson';
import { extractGuidePaths, openRing } from './extract';

describe('openRing', () => {
	it('drops the repeated close vertex', () => {
		const ring: [number, number][] = [
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 0]
		];
		expect(openRing(ring)).toEqual([
			[0, 0],
			[1, 0],
			[1, 1]
		]);
	});

	it('leaves open rings alone', () => {
		const ring: [number, number][] = [
			[0, 0],
			[1, 0],
			[1, 1]
		];
		expect(openRing(ring)).toEqual(ring);
	});
});

describe('extractGuidePaths', () => {
	it('extracts LineString coordinates', () => {
		const features: Feature[] = [
			{
				type: 'Feature',
				properties: { tool: 'polyline' },
				geometry: {
					type: 'LineString',
					coordinates: [
						[21, 52],
						[21.01, 52.01],
						[21.02, 52.02]
					]
				}
			}
		];
		const paths = extractGuidePaths(features);
		expect(paths).toHaveLength(1);
		expect(paths[0]!.closed).toBe(false);
		expect(paths[0]!.points).toHaveLength(3);
	});

	it('extracts polygon exterior as closed open-ring', () => {
		const features: Feature[] = [
			{
				type: 'Feature',
				properties: { tool: 'polygon' },
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[21, 52],
							[21.02, 52],
							[21.02, 52.02],
							[21, 52.02],
							[21, 52]
						]
					]
				}
			}
		];
		const paths = extractGuidePaths(features);
		expect(paths).toHaveLength(1);
		expect(paths[0]!.closed).toBe(true);
		expect(paths[0]!.points).toHaveLength(4);
		expect(paths[0]!.points[0]).toEqual([21, 52]);
	});

	it('preserves multi-feature order', () => {
		const features: Feature[] = [
			{
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: [
						[0, 0],
						[1, 1]
					]
				}
			},
			{
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: [
						[2, 2],
						[3, 3]
					]
				}
			}
		];
		const paths = extractGuidePaths(features);
		expect(paths.map((path) => path.points[0])).toEqual([
			[0, 0],
			[2, 2]
		]);
	});

	it('skips unsupported Point geometry', () => {
		const features: Feature[] = [
			{
				type: 'Feature',
				properties: {},
				geometry: { type: 'Point', coordinates: [21, 52] }
			}
		];
		expect(extractGuidePaths(features)).toEqual([]);
	});
});
