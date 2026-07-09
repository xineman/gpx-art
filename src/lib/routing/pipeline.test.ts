import { describe, expect, test, vi, afterEach } from 'vitest';
import {
	STRUCTURED_EDGE_VIA_MIN_METERS,
	STRUCTURED_MAX_VIAS_PER_EDGE,
	STRUCTURED_VIA_SPACING_METERS
} from '$lib/constants/routing';
import type { Point, Shape } from '$lib/types/sketch';
import {
	densifyStructuredVias,
	maxDeviationFromSegment,
	maxEdgeMeters,
	needsStructuredEdgeVias,
	prepareShapeRoute,
	routeAdaptiveEdge,
	routePreparedStructured,
	routingChain,
	shapeEndpoints,
	subsampleKeepEnds
} from './pipeline';
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
		// Offset purely in latitude so deg() meters match.
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

describe('prepareShapeRoute', () => {
	test('tiny rectangle uses corner-only /route without edgeCorners adaptive', () => {
		const d = deg(11);
		const rect = shape('r', 'rectangle', [
			point(52, 21),
			point(52, 21 + d),
			point(52 + d, 21 + d),
			point(52 + d, 21)
		]);
		const prepared = prepareShapeRoute(rect, false);
		expect(prepared.callKind).toBe('route');
		expect(prepared.edgeCorners).toBeUndefined();
		expect(prepared.points).toHaveLength(5);
	});

	test('large rectangle sets edgeCorners for adaptive per-edge routing', () => {
		const d = deg(STRUCTURED_VIA_SPACING_METERS * 2 + 50);
		const rect = shape('r', 'rectangle', [
			point(52, 21),
			point(52, 21 + d),
			point(52 + d, 21 + d),
			point(52 + d, 21)
		]);
		const prepared = prepareShapeRoute(rect, false);
		expect(prepared.callKind).toBe('route');
		expect(prepared.edgeCorners).toBeDefined();
		expect(prepared.edgeCorners!.length).toBe(5); // closed
		expect(needsStructuredEdgeVias(routingChain(rect, false))).toBe(true);
	});

	test('short 2-point line uses /route', () => {
		const d = deg(30);
		const line = shape('l', 'line', [point(52, 21), point(52 + d, 21)]);
		const prepared = prepareShapeRoute(line, false);
		expect(prepared.callKind).toBe('route');
		expect(prepared.points).toHaveLength(2);
	});

	test('long 2-point line uses edgeCorners', () => {
		const d = deg(STRUCTURED_VIA_SPACING_METERS * 2 + 50);
		const line = shape('l', 'line', [point(52, 21), point(52 + d, 21)]);
		const prepared = prepareShapeRoute(line, false);
		expect(prepared.edgeCorners).toEqual(prepared.points);
	});

	test('pencil uses match callKind (route-first pipeline entry)', () => {
		const pts = Array.from({ length: 5 }, (_, i) => point(52 + i * deg(10), 21));
		expect(prepareShapeRoute(shape('p', 'pencil', pts), false).callKind).toBe('match');
	});
});

describe('routeAdaptiveEdge', () => {
	test('keeps simple A→B when path already tracks the edge', async () => {
		const a = point(52, 21);
		const b = point(52 + deg(500), 21);
		// Path on the edge itself.
		const onEdge = [a, point(52 + deg(250), 21), b];
		const geom = encodePolyline(onEdge);

		const routeFn = vi.fn(async () => ({
			geometry: geom,
			distance: 500,
			duration: 100
		}));

		const result = await routeAdaptiveEdge(a, b, routeFn as never);
		// Only one call — densify not attempted.
		expect(routeFn).toHaveBeenCalledTimes(1);
		expect(result.geometry).toBe(geom);
	});

	test('tries densify when simple path wanders, keeps simple if densify is worse', async () => {
		const a = point(52, 21);
		const b = point(52 + deg(1000), 21);
		const wandering = [a, point(52 + deg(500), 21 + deg(500)), b]; // ~500 m off
		const worseDense = [
			a,
			point(52 + deg(300), 21 + deg(800)),
			point(52 + deg(700), 21 + deg(800)),
			b
		];

		let call = 0;
		const routeFn = vi.fn(async (pts: Point[]) => {
			call++;
			if (pts.length === 2) {
				return { geometry: encodePolyline(wandering), distance: 2000, duration: 200 };
			}
			return { geometry: encodePolyline(worseDense), distance: 5000, duration: 500 };
		});

		const result = await routeAdaptiveEdge(a, b, routeFn as never);
		expect(routeFn.mock.calls.length).toBeGreaterThanOrEqual(2);
		// Worse densified rejected → keep simple distance.
		expect(result.distance).toBe(2000);
	});
});

describe('routePreparedStructured', () => {
	test('fires soft-edge + corner-bridge routes for a rectangle', async () => {
		const d = deg(STRUCTURED_VIA_SPACING_METERS * 2 + 50);
		const rect = shape('r', 'rectangle', [
			point(52, 21),
			point(52, 21 + d),
			point(52 + d, 21 + d),
			point(52 + d, 21)
		]);
		const prepared = prepareShapeRoute(rect, false);
		expect(prepared.edgeCorners!.length).toBe(5);

		// Simple path that tracks each segment well so densify is skipped.
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
		// 4 soft edges + 4 corner bridges
		expect(result.geometries.length).toBeGreaterThanOrEqual(4);
		expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
		expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(12);
	});
});
