import { afterEach, describe, expect, test, vi } from 'vitest';
import { MATCH_RADIUS_METERS, MATCH_RADIUS_WAYPOINT_METERS } from '$lib/constants/routing';
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
		// 6 points fits one chunk (max 10) so chunkOutcomes is a single
		// matched entry carrying the per-matching confidence.
		expect(result.chunkOutcomes).toEqual([{ kind: 'matched', confidence: 0.8 }]);
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

	test('falls back from NoMatch to a /route through the full chunk points', async () => {
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
		// The fallback /route uses the FULL chunk points (not just endpoints)
		// so the route still follows the shape's trajectory when /match
		// rejects a chunk. See commit 6366b8e "Fix route fallback".
		expect(fallbackUrl).toContain(points.map((p) => `${p.lng},${p.lat}`).join(';'));
		expect(fetchMock).toHaveBeenCalledTimes(2);
		// The chunk outcome captures why the fallback was needed so the
		// batch debug legend can surface it.
		expect(result.chunkOutcomes).toEqual([
			{ kind: 'fallback', code: 'NoMatch' }
		]);
	});

	test('emits one chunk outcome per chunk in dispatch order', async () => {
		// 20 anchors → 3 overlapping chunks (stride = 10 - 2 = 8). All three
		// /match calls succeed, so chunkOutcomes should have 3 matched entries
		// in the order chunks were dispatched (Promise.all preserves order).
		const points = Array.from({ length: 20 }, (_, i) => point(i));
		const confidences = [0.91, 0.72, 0.85];
		const fetchMock = vi.spyOn(globalThis, 'fetch');
		for (const confidence of confidences) {
			fetchMock.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						code: 'Ok',
						tracepoints: [{ matchings_index: 0, waypoint_index: 0, alternatives_count: 0 }],
						matchings: [{ geometry: 'g', distance: 50, duration: 10, confidence }]
					}),
					{ status: 200 }
				)
			);
		}

		const result = await getMatchedRoute(points);

		expect(result.chunkOutcomes).toEqual(
			confidences.map((confidence) => ({ kind: 'matched', confidence }))
		);
	});

	test('emits fallback outcomes for individual chunks that fail while others match', async () => {
		// 20 anchors → 3 chunks. Middle chunk returns NoMatch, others match.
		// Each chunk gets its own /route fallback (when needed) or stays as
		// /match geometry; the outcome list interleaves matched and fallback
		// entries in dispatch order so the legend can color them
		// independently.
		//
		// Mock order matches fetch-call order: Promise.all issues all three
		// /match fetches in chunk order before any resolve, so the /route
		// fallback for the failing chunk only fires AFTER chunk 1's /match
		// returns NoMatch — meaning the fallback is the 4th fetch, not the
		// 3rd.
		const points = Array.from({ length: 20 }, (_, i) => point(i));
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						code: 'Ok',
						tracepoints: [{ matchings_index: 0, waypoint_index: 0, alternatives_count: 0 }],
						matchings: [{ geometry: 'g1', distance: 50, duration: 10, confidence: 0.9 }]
					}),
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ code: 'NoMatch', matchings: [] }), { status: 400 })
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						code: 'Ok',
						tracepoints: [{ matchings_index: 0, waypoint_index: 0, alternatives_count: 0 }],
						matchings: [{ geometry: 'g3', distance: 50, duration: 10, confidence: 0.8 }]
					}),
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						code: 'Ok',
						routes: [{ geometry: 'fallback2', distance: 100, duration: 20 }]
					}),
					{ status: 200 }
				)
			);

		const result = await getMatchedRoute(points);

		expect(result.geometries).toEqual(['g1', 'fallback2', 'g3']);
		expect(result.chunkOutcomes).toEqual([
			{ kind: 'matched', confidence: 0.9 },
			{ kind: 'fallback', code: 'NoMatch' },
			{ kind: 'matched', confidence: 0.8 }
		]);
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
