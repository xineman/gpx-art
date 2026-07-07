import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	MATCH_CONFIDENCE_THRESHOLD,
	MATCH_RADIUS_METERS,
	MATCH_RADIUS_WAYPOINT_METERS
} from '$lib/constants/routing';
import { chunkPointsForMatch, getMatchedRoute, matchingIndexesInTraceOrder } from './osrm';

const point = (n: number) => ({ lat: 52 + n * 0.001, lng: 21 + n * 0.001 });

afterEach(() => {
	vi.restoreAllMocks();
});

describe('chunkPointsForMatch', () => {
	test('passes through traces within the public OSRM match limit', () => {
		const points = Array.from({ length: 10 }, (_, i) => point(i));

		expect(chunkPointsForMatch(points)).toEqual([points]);
		expect(chunkPointsForMatch(points)[0]).not.toBe(points);
	});

	test('splits longer traces with two-point overlap by default', () => {
		const points = Array.from({ length: 20 }, (_, i) => point(i));

		const chunks = chunkPointsForMatch(points);

		expect(chunks).toHaveLength(3);
		expect(chunks[0]).toEqual(points.slice(0, 10));
		expect(chunks[1]).toEqual(points.slice(8, 18));
		expect(chunks[2]).toEqual(points.slice(16, 20));
	});

	test('avoids two-point tail chunks when there are enough points to overlap more', () => {
		const points = Array.from({ length: 11 }, (_, i) => point(i));

		const chunks = chunkPointsForMatch(points);

		expect(chunks).toEqual([points.slice(0, 10), points.slice(8, 11)]);
	});

	test('rejects invalid chunk settings', () => {
		const points = [point(0), point(1)];

		expect(() => chunkPointsForMatch(points, 1)).toThrow('at least 2 points');
		expect(() => chunkPointsForMatch(points, 10, -1)).toThrow('between 0');
		expect(() => chunkPointsForMatch(points, 10, 10)).toThrow('between 0');
	});
});

describe('matchingIndexesInTraceOrder', () => {
	test('orders matchings by their first non-null tracepoint and appends unseen matchings', () => {
		const order = matchingIndexesInTraceOrder(
			[
				null,
				{ matchings_index: 2, waypoint_index: 0, alternatives_count: 0 },
				{ matchings_index: 0, waypoint_index: 0, alternatives_count: 0 },
				{ matchings_index: 2, waypoint_index: 1, alternatives_count: 0 }
			],
			4
		);

		expect(order).toEqual([2, 0, 1, 3]);
	});

	test('ignores invalid matching indexes from malformed responses', () => {
		const order = matchingIndexesInTraceOrder(
			[
				{ matchings_index: -1, waypoint_index: 0, alternatives_count: 0 },
				{ matchings_index: 3, waypoint_index: 0, alternatives_count: 0 },
				{ matchings_index: 1, waypoint_index: 0, alternatives_count: 0 }
			],
			2
		);

		expect(order).toEqual([1, 0]);
	});
});

describe('getMatchedRoute', () => {
	test('sends match radiuses and endpoint waypoints', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					code: 'Ok',
					tracepoints: [{ matchings_index: 0, waypoint_index: 0, alternatives_count: 0 }],
					matchings: [{ geometry: 'matched', distance: 100, duration: 20, confidence: 0.8 }]
				}),
				{ status: 200 }
			)
		);

		const result = await getMatchedRoute(Array.from({ length: 6 }, (_, i) => point(i)));
		const url = String(fetchMock.mock.calls[0][0]);

		expect(result.geometries).toEqual(['matched']);
		expect(url).toContain('/match/v1/bike/');
		// Per-coordinate radii: waypoints (index 0 and 5) get the relaxed
		// MATCH_RADIUS_WAYPOINT_METERS; tracepoints (1..4) keep the tighter
		// MATCH_RADIUS_METERS so HMM candidate sets stay small.
		expect(url).toContain(
			`radiuses=${MATCH_RADIUS_WAYPOINT_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_WAYPOINT_METERS}`
		);
		expect(url).toContain('waypoints=0%3B5');
	});

	test('dispatches all chunks in parallel rather than serially', async () => {
		// 20 anchors → 3 overlapping chunks (stride = 10 - 2 = 8).
		const points = Array.from({ length: 20 }, (_, i) => point(i));
		const perChunkDelayMs = 40;
		const fetchStarted: number[] = [];
		let activeConcurrent = 0;
		let peakConcurrent = 0;

		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			fetchStarted.push(performance.now());
			activeConcurrent++;
			peakConcurrent = Math.max(peakConcurrent, activeConcurrent);
			await new Promise((r) => setTimeout(r, perChunkDelayMs));
			activeConcurrent--;
			return new Response(
				JSON.stringify({
					code: 'Ok',
					tracepoints: [{ matchings_index: 0, waypoint_index: 0, alternatives_count: 0 }],
					matchings: [{ geometry: 'g', distance: 50, duration: 10, confidence: 1 }]
				}),
				{ status: 200 }
			);
		});

		const result = await getMatchedRoute(points);

		expect(fetchStarted).toHaveLength(3);
		expect(peakConcurrent).toBe(3);
		expect(result.geometries).toEqual(['g', 'g', 'g']);
	});

	test('falls back from NoMatch to a route between chunk endpoints only', async () => {
		const points = Array.from({ length: 6 }, (_, i) => point(i));
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ code: 'NoMatch', message: 'Could not match the trace.' }), {
					status: 400
				})
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						code: 'Ok',
						routes: [{ geometry: 'fallback', distance: 200, duration: 40 }]
					}),
					{ status: 200 }
				)
			);

		const result = await getMatchedRoute(points);
		const fallbackUrl = String(fetchMock.mock.calls[1][0]);

		expect(result.geometries).toEqual(['fallback']);
		expect(fallbackUrl).toContain('/route/v1/bike/');
		expect(fallbackUrl).toContain(`${points[0].lng},${points[0].lat}`);
		expect(fallbackUrl).toContain(`${points.at(-1)?.lng},${points.at(-1)?.lat}`);
		expect(fallbackUrl).not.toContain(`${points[1].lng},${points[1].lat}`);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test('falls back from sub-threshold confidence to a route between chunk endpoints only', async () => {
		const points = Array.from({ length: 6 }, (_, i) => point(i));
		const lowConfidence = MATCH_CONFIDENCE_THRESHOLD - 0.01;
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						code: 'Ok',
						tracepoints: [
							{ matchings_index: 0, waypoint_index: 0, alternatives_count: 0 },
							null,
							null,
							null,
							null,
							{ matchings_index: 0, waypoint_index: 1, alternatives_count: 0 }
						],
						matchings: [
							{ geometry: 'lowconf', distance: 100, duration: 20, confidence: lowConfidence }
						]
					}),
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						code: 'Ok',
						routes: [{ geometry: 'fallback', distance: 200, duration: 40 }]
					}),
					{ status: 200 }
				)
			);

		const result = await getMatchedRoute(points);
		const fallbackUrl = String(fetchMock.mock.calls[1][0]);

		expect(result.geometries).toEqual(['fallback']);
		expect(fallbackUrl).toContain('/route/v1/bike/');
		expect(fallbackUrl).toContain(`${points[0].lng},${points[0].lat}`);
		expect(fallbackUrl).toContain(`${points.at(-1)?.lng},${points.at(-1)?.lat}`);
		expect(fallbackUrl).not.toContain(`${points[1].lng},${points[1].lat}`);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test('trusts matchings at or above the confidence threshold', async () => {
		const atThreshold = MATCH_CONFIDENCE_THRESHOLD;
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					code: 'Ok',
					tracepoints: [
						{ matchings_index: 0, waypoint_index: 0, alternatives_count: 0 },
						{ matchings_index: 0, waypoint_index: null, alternatives_count: 0 },
						{ matchings_index: 0, waypoint_index: null, alternatives_count: 0 },
						{ matchings_index: 0, waypoint_index: null, alternatives_count: 0 },
						{ matchings_index: 0, waypoint_index: null, alternatives_count: 0 },
						{ matchings_index: 0, waypoint_index: 1, alternatives_count: 0 }
					],
					matchings: [{ geometry: 'trusted', distance: 100, duration: 20, confidence: atThreshold }]
				}),
				{ status: 200 }
			)
		);

		const result = await getMatchedRoute(Array.from({ length: 6 }, (_, i) => point(i)));

		expect(result.geometries).toEqual(['trusted']);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test('does not fallback for non-NoMatch OSRM errors', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(JSON.stringify({ code: 'InvalidQuery', message: 'Bad query.' }), { status: 400 })
		);

		await expect(getMatchedRoute(Array.from({ length: 6 }, (_, i) => point(i)))).rejects.toThrow(
			'InvalidQuery'
		);
	});
});
