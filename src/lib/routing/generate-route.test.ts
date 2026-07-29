import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Position } from 'geojson';
import { requestOptimizedRoute } from './generate-route';

const routeSuccess = {
	ok: true,
	geometry: {
		type: 'LineString',
		coordinates: [
			[0, 0],
			[1, 0]
		]
	},
	distanceM: 500,
	waypoints: [
		[0, 0],
		[1, 0]
	]
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('requestOptimizedRoute', () => {
	it('requests Matrix, optimizes in the browser, then sends ordered vias to Route', async () => {
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			if (String(input) === '/api/matrix') {
				const { coordinates } = JSON.parse(String(init?.body)) as { coordinates: Position[] };
				const distances = coordinates.map((from) =>
					coordinates.map((to) => {
						if (from[0] === to[0]) return 0;
						return from[0] === 1 && to[0] === 10 ? 1 : 100;
					})
				);
				return Response.json({ ok: true, distances });
			}

			const request = JSON.parse(String(init?.body)) as { vias: { location: Position }[] };
			return Response.json({
				...routeSuccess,
				geometry: { type: 'LineString', coordinates: request.vias.map(({ location }) => location) },
				waypoints: request.vias.map(({ location }) => location)
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await requestOptimizedRoute([
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
		]);

		expect(result.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/matrix', '/api/route']);
		const routeBody = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body));
		expect(routeBody).toEqual({
			vias: [
				{ location: [0, 0] },
				{ location: [1, 0] },
				{ location: [10, 0] },
				{ location: [11, 0] }
			]
		});
	});

	it('skips Matrix for one shape', async () => {
		const fetchMock = vi.fn(async () => Response.json(routeSuccess));
		vi.stubGlobal('fetch', fetchMock);

		await requestOptimizedRoute([
			{
				closed: false,
				vias: [
					[0, 0],
					[1, 0]
				]
			}
		]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith('/api/route', expect.any(Object));
	});

	it.each([
		['Matrix failure', { ok: false, error: 'Matrix unavailable.' }],
		['invalid matrix', { ok: true, distances: [[0]] }]
	])('does not call Route after %s', async (_, matrixResponse) => {
		const fetchMock = vi.fn(async () => Response.json(matrixResponse));
		vi.stubGlobal('fetch', fetchMock);

		const result = await requestOptimizedRoute([
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
		]);

		expect(result.ok).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith('/api/matrix', expect.any(Object));
	});
});
