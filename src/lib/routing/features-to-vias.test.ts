import { describe, expect, it } from 'vitest';
import type { Feature } from 'geojson';
import { featuresToVias } from './features-to-vias';

describe('featuresToVias', () => {
	it('builds vias from a polyline', () => {
		const features: Feature[] = [
			{
				type: 'Feature',
				properties: { id: 'a', tool: 'polyline' },
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
		const result = featuresToVias(features);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.vias.length).toBeGreaterThanOrEqual(2);
	});

	it('re-appends the start for polygon vias', () => {
		const features: Feature[] = [
			{
				type: 'Feature',
				properties: { id: 'poly', tool: 'polygon' },
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
		const result = featuresToVias(features);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const vias = result.vias;
		const first = vias[0]!;
		const last = vias[vias.length - 1]!;
		expect(first[0]).toBe(last[0]);
		expect(first[1]).toBe(last[1]);
	});

	it('rejects empty sketch', () => {
		const result = featuresToVias([]);
		expect(result.ok).toBe(false);
	});

	it('combines multi-feature vias in order and removes boundary duplicates', () => {
		const features: Feature[] = [
			{
				type: 'Feature',
				properties: { id: '1' },
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
				properties: { id: '2' },
				geometry: {
					type: 'LineString',
					coordinates: [
						[1, 1],
						[2, 2]
					]
				}
			}
		];
		const result = featuresToVias(features, { maxVias: 4 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.vias).toEqual([
			[0, 0],
			[1, 1],
			[2, 2]
		]);
	});

	it('shares one via budget across shapes while preserving a closed loop', () => {
		const features: Feature[] = [
			{
				type: 'Feature',
				properties: { id: 'line' },
				geometry: {
					type: 'LineString',
					coordinates: [
						[21, 52],
						[21.01, 52.01],
						[21.02, 52.02]
					]
				}
			},
			{
				type: 'Feature',
				properties: { id: 'loop' },
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[21.03, 52.03],
							[21.04, 52.03],
							[21.04, 52.04],
							[21.03, 52.04],
							[21.03, 52.03]
						]
					]
				}
			}
		];

		const result = featuresToVias(features, { maxVias: 5 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.vias).toHaveLength(5);
		const closed = result.vias.slice(2);
		expect(closed).toHaveLength(3);
		expect(closed[0]).toEqual(closed[closed.length - 1]);
	});

	it('rejects sketches whose route-wide minimum exceeds the via cap', () => {
		const features: Feature[] = Array.from({ length: 21 }, (_, index) => ({
			type: 'Feature',
			properties: { id: String(index) },
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[index, 0],
						[index + 0.1, 0],
						[index + 0.1, 0.1],
						[index, 0]
					]
				]
			}
		}));

		const result = featuresToVias(features);
		expect(result).toEqual({
			ok: false,
			error: 'Too many shapes to route at once (max 60 waypoints).'
		});
	});
});
