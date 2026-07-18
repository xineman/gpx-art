import { describe, expect, it, vi } from 'vitest';
import { buildOsrmRouteUrl, fetchOsrmRoute } from './osrm';

describe('buildOsrmRouteUrl', () => {
	it('encodes vias and query flags', () => {
		const url = buildOsrmRouteUrl('https://routing.openstreetmap.de/routed-bike/', 'driving', {
			vias: [{ location: [21.0, 52.2] }, { location: [21.01, 52.21] }]
		});
		expect(url).toContain('https://routing.openstreetmap.de/routed-bike/route/v1/driving/');
		expect(url).toContain('21,52.2;21.01,52.21');
		expect(url).toContain('geometries=geojson');
		expect(url).toContain('overview=full');
		expect(new URL(url).searchParams.get('generate_hints')).toBe('false');
	});

	it('encodes optional snapping constraints for a refinement request', () => {
		const url = buildOsrmRouteUrl('https://example.test', 'driving', {
			vias: [
				{ location: [21, 52] },
				{ location: [21.01, 52.01], radiusM: 20, bearing: 45, bearingRange: 30 }
			],
			continueStraight: true
		});
		const params = new URL(url).searchParams;
		expect(params.has('hints')).toBe(false);
		expect(params.get('generate_hints')).toBe('false');
		expect(params.get('radiuses')).toBe(';20');
		expect(params.get('bearings')).toBe(';45,30');
		expect(params.get('continue_straight')).toBe('true');
	});

	it('preserves an explicit false continue-straight option', () => {
		const url = buildOsrmRouteUrl('https://example.test', 'driving', {
			vias: [{ location: [21, 52] }, { location: [21.01, 52.01] }],
			continueStraight: false
		});
		expect(new URL(url).searchParams.get('continue_straight')).toBe('false');
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
			{
				vias: [{ location: [21, 52] }, { location: [21.01, 52.01] }]
			},
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

		const result = await fetchOsrmRoute(
			{ vias: vias.map((location) => ({ location })) },
			{
				baseUrl: 'https://example.test/routed-bike',
				profile: 'driving',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.waypoints).toEqual(vias);
	});

	it('maps NoRoute to a friendly error', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({ code: 'NoRoute', message: 'No route found' })
		);

		const result = await fetchOsrmRoute(
			{
				vias: [{ location: [21, 52] }, { location: [21.01, 52.01] }]
			},
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
			{
				vias: [{ location: [21, 52] }, { location: [21.01, 52.01] }]
			},
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
