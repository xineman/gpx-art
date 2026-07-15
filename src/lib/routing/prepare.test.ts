import { describe, expect, it } from 'vitest';
import type { Feature } from 'geojson';
import { prepareRouteLegs } from './prepare';

describe('prepareRouteLegs', () => {
	it('builds a single open leg from a polyline', () => {
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
		const result = prepareRouteLegs(features);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.legs).toHaveLength(1);
		expect(result.legs[0]!.closed).toBe(false);
		expect(result.legs[0]!.vias.length).toBeGreaterThanOrEqual(2);
		expect(result.waypoints.length).toBe(result.legs[0]!.vias.length);
		expect(result.waypoints[0]).toEqual(result.legs[0]!.vias[0]);
	});

	it('marks polygon legs closed and re-appends start in vias', () => {
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
		const result = prepareRouteLegs(features);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.legs[0]!.closed).toBe(true);
		const vias = result.legs[0]!.vias;
		const first = vias[0]!;
		const last = vias[vias.length - 1]!;
		expect(first[0]).toBe(last[0]);
		expect(first[1]).toBe(last[1]);
	});

	it('rejects empty sketch', () => {
		const result = prepareRouteLegs([]);
		expect(result.ok).toBe(false);
	});

	it('preserves multi-feature leg order', () => {
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
						[2, 2],
						[3, 3]
					]
				}
			}
		];
		const result = prepareRouteLegs(features);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.legs).toHaveLength(2);
		expect(result.legs[0]!.vias[0]).toEqual([0, 0]);
		expect(result.legs[1]!.vias[0]).toEqual([2, 2]);
	});
});
