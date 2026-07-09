import { afterEach, describe, expect, test, vi } from 'vitest';
import { PENCIL_MAX_VIAS } from '$lib/constants/routing';
import { getDistanceTable, getRoute, pencilRouteAnchors } from './osrm';

const point = (n: number) => ({ lat: 52 + n * 0.001, lng: 21 + n * 0.001 });

afterEach(() => {
	vi.restoreAllMocks();
});

describe('pencilRouteAnchors', () => {
	test('always returns at least the two endpoints', () => {
		const points = [point(0), point(1)];
		expect(pencilRouteAnchors(points)).toEqual(points);
	});

	test('collapses a long collinear chunk and always keeps endpoints', () => {
		// ~10 m steps along lng — all collinear, so RDP collapses to ends.
		const points = Array.from({ length: 20 }, (_, i) => ({
			lat: 52,
			lng: 21 + i * 0.0001
		}));
		const anchors = pencilRouteAnchors(points);

		expect(anchors[0]).toEqual(points[0]);
		expect(anchors.at(-1)).toEqual(points[points.length - 1]);
		expect(anchors.length).toBeLessThan(points.length);
		expect(anchors.length).toBeLessThanOrEqual(PENCIL_MAX_VIAS);
	});

	test('caps dense zig-zags at PENCIL_MAX_VIAS', () => {
		// Alternating north/south jogs so RDP keeps many corners.
		const points = Array.from({ length: 30 }, (_, i) => ({
			lat: 52 + (i % 2 === 0 ? 0 : 0.001),
			lng: 21 + i * 0.0002
		}));
		const anchors = pencilRouteAnchors(points);

		expect(anchors.length).toBeLessThanOrEqual(PENCIL_MAX_VIAS);
		expect(anchors[0]).toEqual(points[0]);
		expect(anchors.at(-1)).toEqual(points[points.length - 1]);
	});

	test('rejects max vias below 2', () => {
		expect(() => pencilRouteAnchors([point(0), point(1)], 25, 1)).toThrow('at least 2');
	});
});

describe('getDistanceTable', () => {
	test('requests annotations=distance and returns the matrix', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					code: 'Ok',
					distances: [
						[0, 10],
						[12, 0]
					]
				}),
				{ status: 200 }
			)
		);

		const matrix = await getDistanceTable([point(0), point(1)]);
		const url = String(fetchMock.mock.calls[0][0]);

		expect(url).toContain('/table/v1/bike/');
		expect(url).toContain('annotations=distance');
		expect(matrix).toEqual([
			[0, 10],
			[12, 0]
		]);
	});

	test('maps null table cells to Infinity', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					code: 'Ok',
					distances: [
						[0, null],
						[null, 0]
					]
				}),
				{ status: 200 }
			)
		);

		const matrix = await getDistanceTable([point(0), point(1)]);
		expect(matrix[0][1]).toBe(Infinity);
		expect(matrix[1][0]).toBe(Infinity);
	});
});

describe('getRoute options', () => {
	test('sends continue_straight and bearings for multi-via routes', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					code: 'Ok',
					routes: [{ geometry: 'poly', distance: 100, duration: 20 }]
				}),
				{ status: 200 }
			)
		);

		await getRoute([point(0), point(1), point(2)], {
			continueStraight: true,
			bearings: [
				{ bearing: 45, range: 75 },
				{ bearing: 90, range: 75 },
				{ bearing: 90, range: 75 }
			]
		});

		const url = String(fetchMock.mock.calls[0][0]);
		expect(url).toContain('continue_straight=true');
		expect(url).toContain('bearings=');
		expect(url).toContain('45%2C75');
	});

	test('retries without bearings when first request fails', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ code: 'NoRoute', message: 'No route' }), { status: 200 })
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						code: 'Ok',
						routes: [{ geometry: 'poly', distance: 100, duration: 20 }]
					}),
					{ status: 200 }
				)
			);

		const result = await getRoute([point(0), point(1), point(2)], {
			continueStraight: true,
			bearings: [
				{ bearing: 0, range: 10 },
				{ bearing: 0, range: 10 },
				{ bearing: 0, range: 10 }
			]
		});

		expect(result.geometry).toBe('poly');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(String(fetchMock.mock.calls[1][0])).not.toContain('bearings=');
	});
});
