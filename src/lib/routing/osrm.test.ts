import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	MATCH_FALLBACK_MAX_VIAS,
	MATCH_RADIUS_METERS,
	MATCH_RADIUS_WAYPOINT_METERS
} from '$lib/constants/routing';
import {
	chunkPointsForMatch,
	getDistanceTable,
	getMatchedRoute,
	getRoute,
	isPathologicalDetour,
	isSparseRouteAcceptable,
	matchingIndexesInTraceOrder,
	sparseFallbackAnchors
} from './osrm';

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

describe('sparseFallbackAnchors', () => {
	test('always returns at least the two endpoints', () => {
		const points = [point(0), point(1)];
		expect(sparseFallbackAnchors(points)).toEqual(points);
	});

	test('collapses a long collinear chunk and always keeps endpoints', () => {
		// ~10 m steps along lng — all collinear, so RDP collapses to ends.
		const points = Array.from({ length: 20 }, (_, i) => ({
			lat: 52,
			lng: 21 + i * 0.0001
		}));
		const anchors = sparseFallbackAnchors(points);

		expect(anchors[0]).toEqual(points[0]);
		expect(anchors.at(-1)).toEqual(points[points.length - 1]);
		expect(anchors.length).toBeLessThan(points.length);
		expect(anchors.length).toBeLessThanOrEqual(MATCH_FALLBACK_MAX_VIAS);
	});

	test('caps dense zig-zags at MATCH_FALLBACK_MAX_VIAS', () => {
		// Alternating north/south jogs so RDP keeps many corners.
		const points = Array.from({ length: 30 }, (_, i) => ({
			lat: 52 + (i % 2 === 0 ? 0 : 0.001),
			lng: 21 + i * 0.0002
		}));
		const anchors = sparseFallbackAnchors(points);

		expect(anchors.length).toBeLessThanOrEqual(MATCH_FALLBACK_MAX_VIAS);
		expect(anchors[0]).toEqual(points[0]);
		expect(anchors.at(-1)).toEqual(points[points.length - 1]);
	});
});

describe('isPathologicalDetour', () => {
	test('keeps matches that track the sketch length', () => {
		expect(isPathologicalDetour(1000, 950, 900)).toBe(false);
	});

	test('rejects plaza-style inflation vs short sketch and short sparse route', () => {
		// Match weaves 2 km; sketch and sparse baseline are ~1 km.
		expect(isPathologicalDetour(2000, 1000, 1050)).toBe(true);
	});

	test('keeps intentional curves where sketch length is already large', () => {
		// Heart lobe: match ≈ sketch, sparse chord-route is shorter.
		expect(isPathologicalDetour(3000, 2900, 1200)).toBe(false);
	});

	test('keeps when sparse route is also long (road network requires detour)', () => {
		// Match 2 km; sketch short but sparse route also ~2 km → not pathological.
		expect(isPathologicalDetour(2000, 1000, 1900)).toBe(false);
	});
});

describe('isSparseRouteAcceptable', () => {
	test('accepts when sparse and sketch lengths are close', () => {
		expect(isSparseRouteAcceptable(1000, 950)).toBe(true);
		expect(isSparseRouteAcceptable(1000, 1200)).toBe(true);
	});

	test('rejects chord shortcuts (sketch much longer than sparse)', () => {
		// Intentional curve ~3 km; sparse chords to ~1.2 km.
		expect(isSparseRouteAcceptable(3000, 1200)).toBe(false);
	});

	test('rejects hard-via detours (sparse much longer than sketch)', () => {
		expect(isSparseRouteAcceptable(1000, 2000)).toBe(false);
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
	// Helper: route-first always hits /route first. Use a tiny sparse
	// distance to force escalation into /match (sketch ≫ sparse).
	function shortSparseRouteResponse(geometry = 'sparse-short') {
		return new Response(
			JSON.stringify({
				code: 'Ok',
				routes: [{ geometry, distance: 50, duration: 10 }]
			}),
			{ status: 200 }
		);
	}

	function okMatchResponse(
		geometry: string,
		distance: number,
		confidence: number,
		duration = 20
	) {
		return new Response(
			JSON.stringify({
				code: 'Ok',
				tracepoints: [{ matchings_index: 0, waypoint_index: 0, alternatives_count: 0 }],
				matchings: [{ geometry, distance, duration, confidence }]
			}),
			{ status: 200 }
		);
	}

	test('route-first: accepts sparse /route when length fits sketch (no /match)', async () => {
		const points = Array.from({ length: 6 }, (_, i) => point(i));
		// ~700 m sketch for these points; 750 is within DETOUR_RATIO.
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					code: 'Ok',
					routes: [{ geometry: 'route-first', distance: 750, duration: 120 }]
				}),
				{ status: 200 }
			)
		);

		const result = await getMatchedRoute(points);
		const url = String(fetchMock.mock.calls[0][0]);

		expect(result.geometries).toEqual(['route-first']);
		expect(result.chunkOutcomes).toEqual([{ kind: 'routed' }]);
		expect(url).toContain('/route/v1/bike/');
		expect(url).toContain('continue_straight=true');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.routeAnchors?.length).toBeGreaterThanOrEqual(2);
		expect(result.routeAnchors!.length).toBeLessThanOrEqual(MATCH_FALLBACK_MAX_VIAS);
	});

	test('escalates to /match when sparse /route chords the sketch', async () => {
		const points = Array.from({ length: 6 }, (_, i) => point(i));
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(shortSparseRouteResponse())
			.mockResolvedValueOnce(okMatchResponse('matched', 700, 0.8));

		const result = await getMatchedRoute(points);
		const matchUrl = String(fetchMock.mock.calls[1][0]);

		expect(result.geometries).toEqual(['matched']);
		expect(result.chunkOutcomes).toEqual([{ kind: 'matched', confidence: 0.8 }]);
		expect(String(fetchMock.mock.calls[0][0])).toContain('/route/v1/bike/');
		expect(matchUrl).toContain('/match/v1/bike/');
		expect(matchUrl).toContain(
			`radiuses=${MATCH_RADIUS_WAYPOINT_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_WAYPOINT_METERS}`
		);
		expect(matchUrl).toContain('waypoints=0%3B5');
	});

	test('dispatches match chunks in parallel after route-first rejects', async () => {
		const points = Array.from({ length: 20 }, (_, i) => point(i));
		const perChunkDelayMs = 40;
		let activeConcurrent = 0;
		let peakConcurrent = 0;
		let callIndex = 0;

		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = String(input);
			callIndex++;
			// First call is route-first sparse /route — return immediately short.
			if (url.includes('/route/')) {
				return shortSparseRouteResponse();
			}
			activeConcurrent++;
			peakConcurrent = Math.max(peakConcurrent, activeConcurrent);
			await new Promise((r) => setTimeout(r, perChunkDelayMs));
			activeConcurrent--;
			return okMatchResponse('g', 50, 1);
		});

		const result = await getMatchedRoute(points);

		expect(peakConcurrent).toBe(3);
		expect(result.geometries).toEqual(['g', 'g', 'g']);
		expect(callIndex).toBe(4); // 1 sparse + 3 match
	});

	test('falls back from NoMatch to sparse /route after route-first rejects', async () => {
		// Single-chunk shape: reuses the route-first sparse response on NoMatch.
		const points = Array.from({ length: 6 }, (_, i) => point(i));
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(shortSparseRouteResponse('fallback'))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ code: 'NoMatch', message: 'Could not match the trace.' }), {
					status: 400
				})
			);

		const result = await getMatchedRoute(points);

		expect(result.geometries).toEqual(['fallback']);
		expect(result.chunkOutcomes).toEqual([{ kind: 'fallback', code: 'NoMatch' }]);
		// Only route-first + one match — no second sparse /route.
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(String(fetchMock.mock.calls[0][0])).toContain('/route/v1/bike/');
		expect(String(fetchMock.mock.calls[1][0])).toContain('/match/v1/bike/');
	});

	test('rejects pathologically long matches via sparse /route (Detour)', async () => {
		// Route-first rejects (short), match weaves 50 km, reuse short sparse.
		const points = Array.from({ length: 6 }, (_, i) => point(i));
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(shortSparseRouteResponse('straight'))
			.mockResolvedValueOnce(okMatchResponse('woven', 50_000, 0.5, 3600));

		const result = await getMatchedRoute(points);

		expect(result.geometries).toEqual(['straight']);
		expect(result.chunkOutcomes).toEqual([{ kind: 'fallback', code: 'Detour' }]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test('keeps a long match when sketch polyline is also long (intentional curve)', async () => {
		// Large zig-zag sketch; sparse chords (short) → escalate; match ≈ sketch.
		const points = Array.from({ length: 6 }, (_, i) => ({
			lat: 52 + i * 0.01,
			lng: 21 + (i % 2) * 0.01
		}));
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(shortSparseRouteResponse())
			.mockResolvedValueOnce(okMatchResponse('curve', 5500, 0.7, 900));

		const result = await getMatchedRoute(points);

		expect(result.geometries).toEqual(['curve']);
		expect(result.chunkOutcomes).toEqual([{ kind: 'matched', confidence: 0.7 }]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test('emits one chunk outcome per match chunk in dispatch order', async () => {
		const points = Array.from({ length: 20 }, (_, i) => point(i));
		const confidences = [0.91, 0.72, 0.85];
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(shortSparseRouteResponse());
		for (const confidence of confidences) {
			fetchMock.mockResolvedValueOnce(okMatchResponse('g', 50, confidence));
		}

		const result = await getMatchedRoute(points);

		expect(result.chunkOutcomes).toEqual(
			confidences.map((confidence) => ({ kind: 'matched', confidence }))
		);
	});

	test('emits fallback outcomes for individual chunks that fail while others match', async () => {
		const points = Array.from({ length: 20 }, (_, i) => point(i));
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(shortSparseRouteResponse())
			.mockResolvedValueOnce(okMatchResponse('g1', 50, 0.9))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ code: 'NoMatch', matchings: [] }), { status: 400 })
			)
			.mockResolvedValueOnce(okMatchResponse('g3', 50, 0.8))
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

	test('escalates to /match when route-first /route fails hard', async () => {
		const points = Array.from({ length: 6 }, (_, i) => point(i));
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ code: 'NoRoute', message: 'No route' }), { status: 200 })
			)
			.mockResolvedValueOnce(okMatchResponse('matched', 700, 0.9));

		const result = await getMatchedRoute(points);

		expect(result.geometries).toEqual(['matched']);
		expect(result.chunkOutcomes).toEqual([{ kind: 'matched', confidence: 0.9 }]);
		expect(String(fetchMock.mock.calls[0][0])).toContain('/route/');
		expect(String(fetchMock.mock.calls[1][0])).toContain('/match/');
	});

	test('does not fallback for non-NoMatch OSRM match errors after escalate', async () => {
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(shortSparseRouteResponse())
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ code: 'InvalidQuery', message: 'Bad query.' }), {
					status: 400
				})
			);

		await expect(getMatchedRoute(Array.from({ length: 6 }, (_, i) => point(i)))).rejects.toThrow(
			'InvalidQuery'
		);
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
