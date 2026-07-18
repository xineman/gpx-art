import { describe, expect, it, vi } from 'vitest';
import type { Position } from 'geojson';
import {
	generateRoute,
	parseOptimizedRouteRequest,
	parseRouteApiRequest,
	parseRouteRequest
} from './generate';

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

describe('parseOptimizedRouteRequest', () => {
	it('accepts grouped open and closed shapes', () => {
		const request = {
			shapes: [
				{
					closed: false,
					vias: [
						[21, 52],
						[21.01, 52.01]
					]
				},
				{
					closed: true,
					vias: [
						[21.02, 52.02],
						[21.03, 52.03],
						[21.02, 52.02]
					]
				}
			]
		};
		expect(parseOptimizedRouteRequest(request)).toEqual({ ok: true, request });
		expect(parseRouteApiRequest(request)).toEqual({ ok: true, request });
	});

	it('requires closed shapes to repeat their first waypoint', () => {
		const result = parseOptimizedRouteRequest({
			shapes: [
				{
					closed: true,
					vias: [
						[21, 52],
						[21.01, 52.01],
						[21.02, 52.02]
					]
				}
			]
		});
		expect(result).toMatchObject({ ok: false });
		if (result.ok) return;
		expect(result.error).toMatch(/repeat its first waypoint/i);
	});

	it('enforces the route-wide waypoint cap', () => {
		const result = parseOptimizedRouteRequest({
			shapes: Array.from({ length: 31 }, (_, index) => ({
				closed: false,
				vias: [
					[index, 0],
					[index + 0.5, 0]
				]
			}))
		});
		expect(result).toMatchObject({ ok: false });
		if (result.ok) return;
		expect(result.error).toMatch(/max 60/i);
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

	it('optimizes grouped shapes with Table before making one ordered Route request', async () => {
		const requestedUrls: string[] = [];
		const fetchFn = vi.fn((input: string | URL | Request) => {
			const url = new URL(String(input));
			requestedUrls.push(url.toString());
			const coordinates = url.pathname
				.split('/')
				.at(-1)!
				.split(';')
				.map((coordinate) => coordinate.split(',').map(Number));
			if (url.pathname.includes('/table/')) {
				const distances = coordinates.map((from) =>
					coordinates.map((to) => {
						if (from[0] === to[0]) return 0;
						return from[0] === 1 && to[0] === 10 ? 1 : 100;
					})
				);
				return Promise.resolve(Response.json({ code: 'Ok', distances }));
			}
			return Promise.resolve(
				Response.json({
					code: 'Ok',
					waypoints: coordinates.map((location) => ({ location })),
					routes: [
						{
							distance: 500,
							geometry: { type: 'LineString', coordinates }
						}
					]
				})
			);
		});

		const result = await generateRoute(
			{
				shapes: [
					{
						closed: false,
						vias: [
							[10, 0],
							[11, 0]
						]
					},
					{
						closed: false,
						vias: [
							[0, 0],
							[1, 0]
						]
					}
				]
			},
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
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(new URL(requestedUrls[0]!).pathname).toContain('/table/v1/driving/');
		expect(new URL(requestedUrls[1]!).pathname).toContain('/route/v1/driving/0,0;1,0;10,0;11,0');
	});

	it('does not call Route when shape-order Table fails', async () => {
		const fetchFn = vi.fn(async () => Response.json({ code: 'NotImplemented' }));
		const result = await generateRoute(
			{
				shapes: [
					{
						closed: false,
						vias: [
							[0, 0],
							[1, 0]
						]
					},
					{
						closed: false,
						vias: [
							[10, 0],
							[11, 0]
						]
					}
				]
			},
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
			error: 'Couldn’t optimize shape order — no bike-distance table is available.'
		});
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('skips Table for a single grouped shape', async () => {
		let requestedUrl = '';
		const fetchFn = vi.fn(async (input: string | URL | Request) => {
			requestedUrl = String(input);
			return Response.json({
				code: 'Ok',
				routes: [
					{
						distance: 100,
						geometry: {
							type: 'LineString',
							coordinates: [
								[0, 0],
								[1, 0]
							]
						}
					}
				]
			});
		});
		const result = await generateRoute(
			{
				shapes: [
					{
						closed: false,
						vias: [
							[0, 0],
							[1, 0]
						]
					}
				]
			},
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
		expect(requestedUrl).toContain('/route/v1/');
	});
});
