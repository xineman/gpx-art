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

	it('deduplicates consecutive vias', () => {
		const result = parseRouteRequest({
			vias: [{ location: [21, 52] }, { location: [21, 52] }, { location: [21.01, 52.01] }]
		});
		expect(result).toEqual({
			ok: true,
			request: {
				vias: [{ location: [21, 52] }, { location: [21.01, 52.01] }]
			}
		});
	});
});

describe('generateRoute', () => {
	it('returns a Valhalla map match as a LineString', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({
				shape: '????',
				edges: [{ length: 0.5 }],
				matched_points: [
					{ lon: 21, lat: 52, type: 'matched' },
					{ lon: 21.01, lat: 52.01, type: 'matched' }
				]
			})
		);

		const result = await generateRoute(
			routeRequest([
				[21, 52],
				[21.01, 52.01]
			]),
			{
				valhalla: {
					baseUrl: 'https://example.test',
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

	it('matches multiple shapes in one ordered Valhalla request', async () => {
		let requestedBody = '';
		const fetchFn = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
			requestedBody = String(init?.body);
			return Promise.resolve(
				Response.json({
					shape: '????',
					edges: [{ length: 1.5 }]
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
				valhalla: {
					baseUrl: 'https://example.test',
					userAgent: 'test',
					fetchFn: fetchFn as unknown as typeof fetch
				}
			}
		);

		expect(result.ok).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(JSON.parse(requestedBody).shape).toEqual([
			{ lat: 52, lon: 21 },
			{ lat: 52.01, lon: 21.01 },
			{ lat: 52.02, lon: 21.02 },
			{ lat: 52.03, lon: 21.03 }
		]);
		if (!result.ok) return;
		expect(result.distanceM).toBe(1_500);
	});

	it('fails the complete route when Valhalla cannot match the combined trace', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({ error: 'No path could be found for input' }, { status: 400 })
		);

		const result = await generateRoute(
			routeRequest([
				[21, 52],
				[21.01, 52.01],
				[21.02, 52.02],
				[21.03, 52.03]
			]),
			{
				valhalla: {
					baseUrl: 'https://example.test',
					userAgent: 'test',
					fetchFn: fetchFn as unknown as typeof fetch
				}
			}
		);

		expect(result).toEqual({
			ok: false,
			error: 'No bike route found near that sketch — try closer to roads.',
			status: 400
		});
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});
