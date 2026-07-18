import { describe, expect, it, vi } from 'vitest';
import type { Position } from 'geojson';
import { generateRoute, parseRouteRequest } from './generate';

function routeRequest(locations: Position[]) {
	return { vias: locations.map((location) => ({ location })) };
}

describe('parseRouteRequest', () => {
	it('accepts a minimal valid route', () => {
		expect(
			parseRouteRequest(
				routeRequest([
					[21, 52],
					[21.01, 52.01]
				])
			)
		).toEqual({
			ok: true,
			request: routeRequest([
				[21, 52],
				[21.01, 52.01]
			])
		});
	});

	it('rejects empty vias', () => {
		const result = parseRouteRequest({ vias: [] });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/at least 2/i);
	});

	it('rejects too few vias', () => {
		const result = parseRouteRequest(routeRequest([[21, 52]]));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/at least 2/i);
	});

	it('rejects non-finite coords', () => {
		const result = parseRouteRequest(
			routeRequest([
				[21, 52],
				[NaN, 52]
			])
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/valid/i);
	});

	it('rejects out-of-range coords', () => {
		const result = parseRouteRequest(
			routeRequest([
				[21, 52],
				[200, 52]
			])
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/range/i);
	});

	it.each([
		['radius', { radiusM: -1 }, /radius/i],
		['bearing', { bearing: 45.5 }, /bearing/i],
		['bearing range', { bearing: 45, bearingRange: 181 }, /bearing range/i],
		['orphan bearing range', { bearingRange: 45 }, /bearing range/i]
	])('rejects an invalid %s', (_, constraint, expectedError) => {
		const result = parseRouteRequest({
			vias: [{ location: [21, 52], ...constraint }, { location: [21.01, 52.01] }]
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(expectedError as RegExp);
	});

	it('rejects a non-boolean continueStraight option', () => {
		const result = parseRouteRequest({
			...routeRequest([
				[21, 52],
				[21.01, 52.01]
			]),
			continueStraight: 'true'
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/boolean/i);
	});

	it('deduplicates consecutive vias and preserves an explicit false option', () => {
		const result = parseRouteRequest({
			vias: [{ location: [21, 52] }, { location: [21, 52] }, { location: [21.01, 52.01] }],
			continueStraight: false
		});
		expect(result).toEqual({
			ok: true,
			request: {
				vias: [{ location: [21, 52] }, { location: [21.01, 52.01] }],
				continueStraight: false
			}
		});
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
			routeRequest([
				[21, 52],
				[21.01, 52.01]
			]),
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
			routeRequest([
				[21, 52],
				[21.01, 52.01],
				[21.02, 52.02],
				[21.03, 52.03]
			]),
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
			routeRequest([
				[21, 52],
				[21.01, 52.01],
				[21.02, 52.02],
				[21.03, 52.03]
			]),
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
