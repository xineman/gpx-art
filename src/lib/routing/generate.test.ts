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
	it('returns a single-leg OSRM success as a LineString', async () => {
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

	it('routes multiple legs in one ordered OSRM request', async () => {
		let requestedUrl = '';
		const fetchFn = vi.fn((url: string | URL | Request) => {
			requestedUrl = String(url);
			return Promise.resolve(
				Response.json({
					code: 'Ok',
					routes: [
						{
							distance: 1_500,
							geometry: {
								type: 'LineString',
								coordinates: [
									[21, 52],
									[21.01, 52.01],
									[21.02, 52.02],
									[21.03, 52.03]
								]
							}
						}
					]
				})
			);
		});

		const result = await generateRouteFromLegs(
			[
				{
					vias: [
						[21, 52],
						[21.01, 52.01]
					],
					closed: false
				},
				{
					vias: [
						[21.02, 52.02],
						[21.03, 52.03]
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
		expect(fetchFn).toHaveBeenCalledTimes(1);
		const requestUrl = new URL(requestedUrl);
		expect(requestUrl.pathname).toContain('21,52;21.01,52.01;21.02,52.02;21.03,52.03');
		if (!result.ok) return;
		expect(result.viaCount).toBe(4);
		expect(result.distanceM).toBe(1_500);
	});

	it('fails the complete route when OSRM cannot route the combined vias', async () => {
		const fetchFn = vi.fn(async () => Response.json({ code: 'NoRoute', message: 'No route' }));

		const result = await generateRouteFromLegs(
			[
				{
					vias: [
						[21, 52],
						[21.01, 52.01]
					]
				},
				{
					vias: [
						[21.02, 52.02],
						[21.03, 52.03]
					]
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

		expect(result).toEqual({
			ok: false,
			error: 'No bike route found near that sketch — try closer to roads.'
		});
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});
