import { describe, expect, it, vi } from 'vitest';
import type { Position } from 'geojson';
import { generateRoute } from './route.server';

function routeRequest(locations: Position[]) {
	return { vias: locations.map((location) => ({ location })) };
}

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
