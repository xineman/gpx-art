import { describe, expect, it, vi } from 'vitest';
import { buildOsrmRouteUrl, fetchOsrmRoute } from './osrm';

describe('buildOsrmRouteUrl', () => {
	it('encodes vias and query flags', () => {
		const url = buildOsrmRouteUrl('https://routing.openstreetmap.de/routed-bike/', 'driving', [
			[21.0, 52.2],
			[21.01, 52.21]
		]);
		expect(url).toContain('https://routing.openstreetmap.de/routed-bike/route/v1/driving/');
		expect(url).toContain('21,52.2;21.01,52.21');
		expect(url).toContain('geometries=geojson');
		expect(url).toContain('overview=full');
	});
});

describe('fetchOsrmRoute', () => {
	it('parses a successful OSRM payload', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({
				code: 'Ok',
				waypoints: [{ location: [21.0001, 52.0001] }, { location: [21.0099, 52.0099] }],
				routes: [
					{
						distance: 1234,
						geometry: {
							type: 'LineString',
							coordinates: [
								[21, 52],
								[21.01, 52.01]
							]
						}
					}
				]
			})
		);

		const result = await fetchOsrmRoute(
			[
				[21, 52],
				[21.01, 52.01]
			],
			{
				baseUrl: 'https://example.test/routed-bike',
				profile: 'driving',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.distanceM).toBe(1234);
		expect(result.geometry.coordinates).toHaveLength(2);
		expect(result.waypoints).toEqual([
			[21.0001, 52.0001],
			[21.0099, 52.0099]
		]);
	});

	it('falls back to input vias when OSRM omits waypoint matches', async () => {
		const vias = [
			[21, 52],
			[21.01, 52.01]
		];
		const fetchFn = vi.fn(async () =>
			Response.json({
				code: 'Ok',
				routes: [
					{
						geometry: { type: 'LineString', coordinates: vias }
					}
				]
			})
		);

		const result = await fetchOsrmRoute(vias, {
			baseUrl: 'https://example.test/routed-bike',
			profile: 'driving',
			userAgent: 'test',
			fetchFn: fetchFn as unknown as typeof fetch
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.waypoints).toEqual(vias);
	});

	it('maps NoRoute to a friendly error', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({ code: 'NoRoute', message: 'No route found' })
		);

		const result = await fetchOsrmRoute(
			[
				[21, 52],
				[21.01, 52.01]
			],
			{
				baseUrl: 'https://example.test/routed-bike',
				profile: 'driving',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/No bike route/i);
	});

	it('handles network failure', async () => {
		const fetchFn = vi.fn(async () => {
			throw new Error('offline');
		});

		const result = await fetchOsrmRoute(
			[
				[21, 52],
				[21.01, 52.01]
			],
			{
				baseUrl: 'https://example.test/routed-bike',
				profile: 'driving',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/reach the routing/i);
	});
});
