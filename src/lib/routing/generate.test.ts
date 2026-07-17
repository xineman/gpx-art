import { describe, expect, it, vi } from 'vitest';
import { generateRoute, validateRouteVias } from './generate';

describe('validateRouteVias', () => {
	it('accepts a minimal valid route', () => {
		expect(
			validateRouteVias([
				[21, 52],
				[21.01, 52.01]
			])
		).toBeNull();
	});

	it('rejects empty vias', () => {
		expect(validateRouteVias([])).toMatch(/at least 2/i);
	});

	it('rejects too few vias', () => {
		expect(validateRouteVias([[21, 52]])).toMatch(/at least 2/i);
	});

	it('rejects non-finite coords', () => {
		expect(
			validateRouteVias([
				[21, 52],
				[NaN, 52]
			])
		).toMatch(/valid/i);
	});

	it('rejects out-of-range coords', () => {
		expect(
			validateRouteVias([
				[21, 52],
				[200, 52]
			])
		).toMatch(/range/i);
	});
});

describe('generateRoute', () => {
	it('returns an OSRM success as a LineString', async () => {
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

		const result = await generateRoute(
			[
				[21, 52],
				[21.01, 52.01]
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
		expect(result.distanceM).toBe(500);
		expect(result.waypoints).toEqual([
			[21, 52],
			[21.01, 52.01]
		]);
	});

	it('routes multiple shapes in one ordered OSRM request', async () => {
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

		const result = await generateRoute(
			[
				[21, 52],
				[21.01, 52.01],
				[21.02, 52.02],
				[21.03, 52.03]
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
		expect(result.distanceM).toBe(1_500);
	});

	it('fails the complete route when OSRM cannot route the combined vias', async () => {
		const fetchFn = vi.fn(async () => Response.json({ code: 'NoRoute', message: 'No route' }));

		const result = await generateRoute(
			[
				[21, 52],
				[21.01, 52.01],
				[21.02, 52.02],
				[21.03, 52.03]
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
