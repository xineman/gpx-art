import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	MATCH_FALLBACK_MAX_VIAS,
	MATCH_RADIUS_METERS,
	MATCH_RADIUS_WAYPOINT_METERS
} from '$lib/constants/routing';
import {
	chunkPointsForMatch,
	getMatchedRoute,
	isPathologicalDetour,
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
					// distance near sketch length so detour gate does not fire
					matchings: [{ geometry: 'matched', distance: 100, duration: 20, confidence: 0.8 }]
				}),
				{ status: 200 }
			)
		);

		const result = await getMatchedRoute(Array.from({ length: 6 }, (_, i) => point(i)));
		const url = String(fetchMock.mock.calls[0][0]);

		expect(result.geometries).toEqual(['matched']);
		expect(url).toContain('/match/v1/bike/');
		expect(url).toContain(
			`radiuses=${MATCH_RADIUS_WAYPOINT_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_METERS}%3B${MATCH_RADIUS_WAYPOINT_METERS}`
		);
		expect(url).toContain('waypoints=0%3B5');
		expect(result.chunkOutcomes).toEqual([{ kind: 'matched', confidence: 0.8 }]);
	});

	test('dispatches all chunks in parallel rather than serially', async () => {
		const points = Array.from({ length: 20 }, (_, i) => point(i));
		const perChunkDelayMs = 40;
		let activeConcurrent = 0;
		let peakConcurrent = 0;

		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
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

		expect(peakConcurrent).toBe(3);
		expect(result.geometries).toEqual(['g', 'g', 'g']);
	});

	test('falls back from NoMatch to a sparse /route (not full chunk)', async () => {
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
		const coordPart = fallbackUrl.split('/route/v1/bike/')[1]?.split('?')[0] ?? '';
		const viaCount = coordPart.split(';').length;

		expect(result.geometries).toEqual(['fallback']);
		expect(fallbackUrl).toContain('/route/v1/bike/');
		// Sparse anchors: fewer (or equal only if already short) than full chunk.
		expect(viaCount).toBeLessThanOrEqual(points.length);
		expect(viaCount).toBeLessThanOrEqual(MATCH_FALLBACK_MAX_VIAS);
		// Endpoints preserved.
		expect(coordPart.startsWith(`${points[0].lng},${points[0].lat}`)).toBe(true);
		expect(coordPart.endsWith(`${points[5].lng},${points[5].lat}`)).toBe(true);
		expect(result.chunkOutcomes).toEqual([{ kind: 'fallback', code: 'NoMatch' }]);
	});

	test('rejects pathologically long matches via sparse /route (Detour)', async () => {
		// sketchDistance for 6 spaced points is small; match claims 50 km.
		const points = Array.from({ length: 6 }, (_, i) => point(i));
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						code: 'Ok',
						tracepoints: [{ matchings_index: 0, waypoint_index: 0, alternatives_count: 0 }],
						matchings: [
							{ geometry: 'woven', distance: 50_000, duration: 3600, confidence: 0.5 }
						]
					}),
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						code: 'Ok',
						routes: [{ geometry: 'straight', distance: 800, duration: 120 }]
					}),
					{ status: 200 }
				)
			);

		const result = await getMatchedRoute(points);

		expect(result.geometries).toEqual(['straight']);
		expect(result.chunkOutcomes).toEqual([{ kind: 'fallback', code: 'Detour' }]);
		expect(String(fetchMock.mock.calls[1][0])).toContain('/route/v1/bike/');
	});

	test('keeps a long match when sketch polyline is also long (intentional curve)', async () => {
		// Points far apart → large totalDistance; match distance similar.
		const points = Array.from({ length: 6 }, (_, i) => ({
			lat: 52 + i * 0.01,
			lng: 21 + (i % 2) * 0.01
		}));
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					code: 'Ok',
					tracepoints: [{ matchings_index: 0, waypoint_index: 0, alternatives_count: 0 }],
					// ~5.5 km — under DETOUR_RATIO × sketch length for this zig-zag
					matchings: [{ geometry: 'curve', distance: 5500, duration: 900, confidence: 0.7 }]
				}),
				{ status: 200 }
			)
		);

		const result = await getMatchedRoute(points);

		expect(result.geometries).toEqual(['curve']);
		expect(result.chunkOutcomes).toEqual([{ kind: 'matched', confidence: 0.7 }]);
		// No sparse-route comparator call.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test('emits one chunk outcome per chunk in dispatch order', async () => {
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
