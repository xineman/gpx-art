import { describe, expect, test, vi, afterEach } from 'vitest';
import {
	STRUCTURED_EDGE_VIA_MIN_METERS,
	STRUCTURED_MAX_VIAS_PER_EDGE,
	STRUCTURED_VIA_SPACING_METERS,
	ROUTE_ANCHOR_CHUNK_SIZE,
	ROUTE_ANCHOR_HARD_CAP
} from '$lib/constants/routing';
import type { Point, Shape } from '$lib/types/sketch';
import {
	anchorBudgetForLength,
	chunkRouteAnchors,
	densifyStructuredVias,
	maxDeviationFromSegment,
	maxEdgeMeters,
	needsStructuredEdgeVias,
	prepareShapeRoute,
	prepareSketchAnchors,
	routeAdaptiveEdge,
	routePreparedStructured,
	routingChain,
	shapeEndpoints,
	shouldApplySoftCorners,
	softCornerPolyline,
	subsampleKeepEnds
} from './pipeline';
import { defaultRoutingOptions } from './options';
import { encodePolyline } from './polyline';

const point = (lat: number, lng: number): Point => ({ lat, lng });
const shape = (id: string, type: Shape['type'], points: Point[]): Shape => ({ id, type, points });
const deg = (meters: number) => meters / 111_000;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('maxEdgeMeters', () => {
	test('returns 0 for fewer than 2 points', () => {
		expect(maxEdgeMeters([])).toBe(0);
		expect(maxEdgeMeters([point(52, 21)])).toBe(0);
	});

	test('reports the longest consecutive edge', () => {
		const short = deg(50);
		const long = deg(200);
		const pts = [point(52, 21), point(52 + short, 21), point(52 + short + long, 21)];
		expect(maxEdgeMeters(pts)).toBeGreaterThan(STRUCTURED_EDGE_VIA_MIN_METERS);
	});
});

describe('shapeEndpoints', () => {
	test('open shape forward and reverse', () => {
		const line = shape('l', 'line', [point(0, 0), point(1, 1), point(2, 0)]);
		expect(shapeEndpoints(line, false)).toMatchObject({
			entry: point(0, 0),
			exit: point(2, 0),
			isClosed: false
		});
		expect(shapeEndpoints(line, true)).toMatchObject({
			entry: point(2, 0),
			exit: point(0, 0),
			isClosed: false
		});
	});

	test('closed shape entry equals exit (full loop leave from start)', () => {
		const rect = shape('r', 'rectangle', [
			point(0, 0),
			point(0, 1),
			point(1, 1),
			point(1, 0)
		]);
		const forward = shapeEndpoints(rect, false);
		expect(forward.entry).toEqual(point(0, 0));
		expect(forward.exit).toEqual(point(0, 0));
		expect(forward.isClosed).toBe(true);
	});
});

describe('densifyStructuredVias', () => {
	test('adds intermediate vias on long edges', () => {
		const d = deg(1000);
		const chain = [point(52, 21), point(52 + d, 21)];
		const vias = densifyStructuredVias(chain);
		expect(vias.length).toBeGreaterThan(2);
		expect(vias.length).toBeLessThanOrEqual(STRUCTURED_MAX_VIAS_PER_EDGE);
	});

	test('caps a single long edge', () => {
		const d = deg(20_000);
		const vias = densifyStructuredVias([point(52, 21), point(52 + d, 21)]);
		expect(vias.length).toBeLessThanOrEqual(STRUCTURED_MAX_VIAS_PER_EDGE);
	});
});

describe('maxDeviationFromSegment', () => {
	test('is ~0 for points on the segment', () => {
		const a = point(52, 21);
		const b = point(52 + deg(1000), 21);
		const mid = point(52 + deg(500), 21);
		expect(maxDeviationFromSegment([a, mid, b], a, b)).toBeLessThan(5);
	});

	test('reports offset for a far point', () => {
		const a = point(52, 21);
		const b = point(52 + deg(1000), 21);
		const far = point(52 + deg(500), 21 + deg(400) / Math.cos((52 * Math.PI) / 180));
		expect(maxDeviationFromSegment([a, far, b], a, b)).toBeGreaterThan(350);
	});
});

describe('subsampleKeepEnds', () => {
	test('keeps endpoints and reduces length', () => {
		const pts = Array.from({ length: 20 }, (_, i) => point(i, 0));
		const out = subsampleKeepEnds(pts, 5);
		expect(out).toHaveLength(5);
		expect(out[0]).toEqual(pts[0]);
		expect(out.at(-1)).toEqual(pts.at(-1));
	});
});

describe('prepareSketchAnchors / budget', () => {
	test('long polylines get more vias than short freehand floor', () => {
		const opts = defaultRoutingOptions();
		const short = anchorBudgetForLength(500, opts);
		const long = anchorBudgetForLength(50_000, opts);
		expect(short).toBe(opts.pencilMaxVias);
		expect(long).toBeGreaterThan(opts.pencilMaxVias);
		expect(long).toBeLessThanOrEqual(ROUTE_ANCHOR_HARD_CAP);
	});

	test('densifies a long 2-point line into multiple anchors', () => {
		const d = deg(STRUCTURED_VIA_SPACING_METERS * 4);
		const chain = [point(52, 21), point(52 + d, 21)];
		const anchors = prepareSketchAnchors(chain);
		expect(anchors.length).toBeGreaterThan(2);
		expect(anchors[0]).toEqual(chain[0]);
		expect(anchors.at(-1)).toEqual(chain[1]);
	});
});

describe('chunkRouteAnchors', () => {
	test('returns single chunk when under limit', () => {
		const pts = Array.from({ length: 10 }, (_, i) => point(i, 0));
		expect(chunkRouteAnchors(pts)).toHaveLength(1);
		expect(chunkRouteAnchors(pts)[0]).toHaveLength(10);
	});

	test('splits long lists with overlapping ends', () => {
		const n = ROUTE_ANCHOR_CHUNK_SIZE + 40;
		const pts = Array.from({ length: n }, (_, i) => point(i, 0));
		const chunks = chunkRouteAnchors(pts);
		expect(chunks.length).toBeGreaterThan(1);
		// Shared via between chunks
		expect(chunks[0].at(-1)).toEqual(chunks[1][0]);
		expect(chunks[0][0]).toEqual(pts[0]);
		expect(chunks.at(-1)!.at(-1)).toEqual(pts.at(-1));
	});
});

describe('soft corners', () => {
	test('applies to sparse long-edge closed rings', () => {
		const d = deg(STRUCTURED_VIA_SPACING_METERS * 2 + 50);
		const chain = [
			point(52, 21),
			point(52, 21 + d),
			point(52 + d, 21 + d),
			point(52 + d, 21),
			point(52, 21)
		];
		expect(shouldApplySoftCorners(chain, 100)).toBe(true);
		const soft = softCornerPolyline(chain, 100);
		expect(soft.length).toBeGreaterThanOrEqual(2);
	});

	test('skips dense freehand-like chains', () => {
		const chain = Array.from({ length: 20 }, (_, i) => point(52 + i * deg(20), 21));
		expect(shouldApplySoftCorners(chain, 100)).toBe(false);
	});
});

describe('prepareShapeRoute (unified)', () => {
	test('pencil and line with same geometry produce the same anchors', () => {
		const pts = Array.from({ length: 16 }, (_, i) => point(52 + i * deg(25), 21));
		const asLine = prepareShapeRoute(shape('l', 'line', pts), false);
		const asPencil = prepareShapeRoute(shape('p', 'pencil', pts), false);
		expect(asLine.points).toEqual(asPencil.points);
		expect(asLine.routeOptions).toEqual({ continueStraight: true });
	});

	test('short 2-point line still produces a valid anchor pair', () => {
		const d = deg(30);
		const line = shape('l', 'line', [point(52, 21), point(52 + d, 21)]);
		const prepared = prepareShapeRoute(line, false);
		expect(prepared.points.length).toBeGreaterThanOrEqual(2);
		expect(prepared.points[0]).toEqual(point(52, 21));
	});

	test('long 2-point line densifies mid-edge anchors (not corners-only)', () => {
		const d = deg(STRUCTURED_VIA_SPACING_METERS * 4);
		const line = shape('l', 'line', [point(52, 21), point(52 + d, 21)]);
		const prepared = prepareShapeRoute(line, false);
		expect(prepared.points.length).toBeGreaterThan(2);
	});

	test('tiny rectangle produces hard-via anchors for /route', () => {
		const d = deg(11);
		const rect = shape('r', 'rectangle', [
			point(52, 21),
			point(52, 21 + d),
			point(52 + d, 21 + d),
			point(52 + d, 21)
		]);
		const prepared = prepareShapeRoute(rect, false);
		expect(prepared.points.length).toBeGreaterThanOrEqual(2);
	});

	test('large rectangle densifies perimeter (soft corners when eligible)', () => {
		const d = deg(STRUCTURED_VIA_SPACING_METERS * 2 + 50);
		const rect = shape('r', 'rectangle', [
			point(52, 21),
			point(52, 21 + d),
			point(52 + d, 21 + d),
			point(52 + d, 21)
		]);
		const prepared = prepareShapeRoute(rect, false);
		expect(prepared.points.length).toBeGreaterThan(4);
		expect(needsStructuredEdgeVias(routingChain(rect, false))).toBe(true);
	});

	test('multi-km sparse line gets many more anchors than vertex count', () => {
		const km = (n: number) => deg(n * 1000);
		const pts = [
			point(51.0, 17.0),
			point(51.0 + km(27), 17.0),
			point(51.0 + km(27), 17.0 + km(34)),
			point(51.0, 17.0 + km(34))
		];
		const prepared = prepareShapeRoute(shape('l', 'line', pts), false);
		expect(prepared.points.length).toBeGreaterThan(pts.length);
		expect(prepared.points.length).toBeLessThanOrEqual(ROUTE_ANCHOR_HARD_CAP);
	});
});

describe('routeAdaptiveEdge', () => {
	test('keeps simple A→B when path already tracks the edge', async () => {
		const a = point(52, 21);
		const b = point(52 + deg(500), 21);
		const onEdge = [a, point(52 + deg(250), 21), b];
		const geom = encodePolyline(onEdge);

		const routeFn = vi.fn(async () => ({
			geometry: geom,
			distance: 500,
			duration: 100
		}));

		const result = await routeAdaptiveEdge(a, b, routeFn as never);
		expect(routeFn).toHaveBeenCalledTimes(1);
		expect(result.geometry).toBe(geom);
	});

	test('tries densify when simple path wanders, keeps simple if densify is worse', async () => {
		const a = point(52, 21);
		const b = point(52 + deg(1000), 21);
		const wandering = [a, point(52 + deg(500), 21 + deg(500)), b];
		const worseDense = [
			a,
			point(52 + deg(300), 21 + deg(800)),
			point(52 + deg(700), 21 + deg(800)),
			b
		];

		const routeFn = vi.fn(async (pts: Point[]) => {
			if (pts.length === 2) {
				return { geometry: encodePolyline(wandering), distance: 2000, duration: 200 };
			}
			return { geometry: encodePolyline(worseDense), distance: 5000, duration: 500 };
		});

		const result = await routeAdaptiveEdge(a, b, routeFn as never);
		expect(routeFn.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(result.distance).toBe(2000);
	});
});

describe('routePreparedStructured', () => {
	test('issues hard-via /route for prepared anchors', async () => {
		const d = deg(STRUCTURED_VIA_SPACING_METERS * 2 + 50);
		const rect = shape('r', 'rectangle', [
			point(52, 21),
			point(52, 21 + d),
			point(52 + d, 21 + d),
			point(52 + d, 21)
		]);
		const prepared = prepareShapeRoute(rect, false);
		expect(prepared.points.length).toBeGreaterThanOrEqual(2);

		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = String(input);
			const coordPart = url.split('/bike/')[1]?.split('?')[0] ?? '';
			const parts = coordPart.split(';').map((c) => {
				const [lng, lat] = c.split(',').map(Number);
				return point(lat, lng);
			});
			const a = parts[0];
			const b = parts[parts.length - 1];
			const mid = point((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
			const geom = encodePolyline([a, mid, b]);
			return new Response(
				JSON.stringify({
					code: 'Ok',
					routes: [{ geometry: geom, distance: 100, duration: 20 }]
				}),
				{ status: 200 }
			);
		});

		const result = await routePreparedStructured(prepared);
		expect(result.geometries.length).toBeGreaterThanOrEqual(1);
		// Single chunk for typical rect anchor counts
		expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
	});
});
