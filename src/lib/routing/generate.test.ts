import { describe, expect, it, vi } from 'vitest';
import { generateRouteFromLegs, validateRouteLegs } from './generate';

describe('validateRouteLegs', () => {
	it('accepts a minimal valid leg', () => {
		expect(
			validateRouteLegs([
				{
					vias: [
						[21, 52],
						[21.01, 52.01]
					]
				}
			])
		).toBeNull();
	});

	it('rejects empty legs', () => {
		expect(validateRouteLegs([])).toMatch(/at least one/i);
	});

	it('rejects too few vias', () => {
		expect(validateRouteLegs([{ vias: [[21, 52]] }])).toMatch(/at least 2/i);
	});

	it('rejects non-finite coords', () => {
		expect(
			validateRouteLegs([
				{
					vias: [
						[21, 52],
						[NaN, 52]
					]
				}
			])
		).toMatch(/valid/i);
	});

	it('rejects out-of-range coords', () => {
		expect(
			validateRouteLegs([
				{
					vias: [
						[21, 52],
						[200, 52]
					]
				}
			])
		).toMatch(/range/i);
	});
});

describe('generateRouteFromLegs', () => {
	it('stitches an OSRM success into a LineString', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({
				code: 'Ok',
				routes: [
					{
						distance: 500,
						geometry: {
							type: 'LineString',
							coordinates: [
								[21, 52],
								[21.005, 52.005],
								[21.01, 52.01]
							]
						}
					}
				]
			})
		);

		const result = await generateRouteFromLegs(
			[
				{
					vias: [
						[21, 52],
						[21.01, 52.01]
					],
					closed: false
				}
			],
			{
				osrm: {
					baseUrl: 'https://example.test/routed-bike',
					profile: 'driving',
					userAgent: 'test',
					fetchFn: fetchFn as unknown as typeof fetch
				}
			}
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.geometry.type).toBe('LineString');
		expect(result.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
		expect(result.viaCount).toBe(2);
		expect(result.distanceM).toBe(500);
	});
});
