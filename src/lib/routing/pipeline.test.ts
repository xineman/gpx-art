import { describe, expect, test, vi, afterEach } from 'vitest';
import {
	STRUCTURED_EDGE_VIA_MIN_METERS,
	STRUCTURED_VIA_SPACING_METERS,
	ROUTE_ANCHOR_CHUNK_SIZE,
	ROUTE_ANCHOR_HARD_CAP
} from '$lib/constants/routing';
import type { Point, Shape } from '$lib/types/sketch';
import {
	anchorBudgetForLength,
	chunkRouteAnchors,
	extractSoftCornerSkeleton,
	maxEdgeMeters,
	prepareShapeRoute,
	prepareSketchAnchors,
	routePreparedShape,
	shapeEndpoints,
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
		expect(chunks[0].at(-1)).toEqual(chunks[1][0]);
		expect(chunks[0][0]).toEqual(pts[0]);
		expect(chunks.at(-1)!.at(-1)).toEqual(pts.at(-1));
	});
});

/** Dense samples along a rectangle perimeter (pencil-drawn rect). */
function freehandRectangle(sideMeters: number, stepMeters: number): Point[] {
	const s = deg(sideMeters);
	const corners = [
		point(52, 21),
		point(52, 21 + s),
		point(52 + s, 21 + s),
		point(52 + s, 21)
	];
	const out: Point[] = [];
	for (let e = 0; e < 4; e++) {
		const a = corners[e];
		const b = corners[(e + 1) % 4];
		const n = Math.max(1, Math.ceil(sideMeters / stepMeters));
		for (let i = 0; i < n; i++) {
			const t = i / n;
			out.push({
				lat: a.lat + (b.lat - a.lat) * t,
				lng: a.lng + (b.lng - a.lng) * t
			});
		}
	}
	out.push(corners[0]);
	return out;
}

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
		const skeleton = extractSoftCornerSkeleton(chain, 100);
		expect(skeleton).not.toBeNull();
		const soft = softCornerPolyline(skeleton!, 100);
		expect(soft.length).toBeGreaterThanOrEqual(2);
	});

	test('skips nearly-straight freehand (no sharp corners)', () => {
		const chain = Array.from({ length: 20 }, (_, i) => point(52 + i * deg(20), 21));
		expect(extractSoftCornerSkeleton(chain, 100)).toBeNull();
	});

	test('detects corners on a dense pencil-style rectangle', () => {
		const chain = freehandRectangle(800, 25);
		expect(chain.length).toBeGreaterThan(24);
		const skeleton = extractSoftCornerSkeleton(chain, 100);
		expect(skeleton).not.toBeNull();
		expect(skeleton!.length).toBeGreaterThanOrEqual(4);
	});

	test('prepareShapeRoute softens a pencil-drawn rectangle (dense freehand)', () => {
		const inset = 100;
		const freehand = freehandRectangle(800, 25);
		const prepared = prepareShapeRoute(shape('p', 'pencil', freehand), false, 0, {
			...defaultRoutingOptions(inset)
		});
		expect(prepared.points.length).toBeGreaterThan(4);
		expect(extractSoftCornerSkeleton(freehand, inset)).not.toBeNull();
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

	test('long 2-point line densifies mid-edge anchors', () => {
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

	test('large rectangle densifies perimeter', () => {
		const d = deg(STRUCTURED_VIA_SPACING_METERS * 2 + 50);
		const rect = shape('r', 'rectangle', [
			point(52, 21),
			point(52, 21 + d),
			point(52 + d, 21 + d),
			point(52 + d, 21)
		]);
		const prepared = prepareShapeRoute(rect, false);
		expect(prepared.points.length).toBeGreaterThan(4);
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

describe('routePreparedShape', () => {
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

		const result = await routePreparedShape(prepared);
		expect(result.geometries.length).toBeGreaterThanOrEqual(1);
		expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
	});
});
