import { describe, expect, test, vi } from 'vitest';
import {
	cleanRoutedPath,
	cleanRoutedPathOnNetwork,
	findCornerWasteSpans,
	findHairpinApexes,
	findLoopSpans,
	isReverseSpur,
	removeHairpins,
	removeShortLoops,
	type SegmentRouter
} from './cleanPath';
import type { Point } from '$lib/types/sketch';
import { totalDistance } from '$lib/geometry/distance';

const p = (lat: number, lng: number): Point => ({ lat, lng });
const deg = (m: number) => m / 111_000;
const degLng = (m: number) => m / 70_000;

const straightBridge: SegmentRouter = async (from, to) => [
	from,
	{ lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 },
	to
];

describe('isReverseSpur', () => {
	test('accepts out-and-back with path≈2×reach', () => {
		const path = [
			p(52, 21),
			p(52 + deg(50), 21),
			p(52 + deg(100), 21),
			p(52 + deg(50), 21),
			p(52 + deg(5), 21)
		];
		const pathLen = totalDistance(path);
		expect(isReverseSpur(path, 0, path.length - 1, pathLen)).toBe(true);
	});

	test('rejects a full rectangle circuit that returns near start', () => {
		// ~400 m sides — return near start after ~1.6 km (over MAX and ratio > 2.5).
		const s = deg(400);
		const path = [
			p(52, 21),
			p(52, 21 + s),
			p(52 + s, 21 + s),
			p(52 + s, 21),
			p(52 + deg(10), 21) // near start
		];
		const pathLen = totalDistance(path);
		expect(isReverseSpur(path, 0, path.length - 1, pathLen)).toBe(false);
	});
});

describe('removeHairpins', () => {
	test('keeps a gentle 90° corner', () => {
		const path = [p(52, 21), p(52, 21 + deg(100)), p(52 + deg(100), 21 + deg(100))];
		expect(removeHairpins(path)).toHaveLength(3);
	});

	test('removes a U-turn apex', () => {
		const path = [p(52, 21), p(52 + deg(100), 21), p(52, 21), p(52, 21 + deg(100))];
		const cleaned = removeHairpins(path);
		expect(cleaned.length).toBeLessThan(path.length);
	});

	test('passes through short paths', () => {
		expect(removeHairpins([p(0, 0), p(1, 1)])).toEqual([p(0, 0), p(1, 1)]);
	});
});

describe('findLoopSpans / removeShortLoops', () => {
	test('collapses a local out-and-back', () => {
		const path = [
			p(52, 21),
			p(52 + deg(50), 21),
			p(52 + deg(100), 21),
			p(52 + deg(50), 21),
			p(52 + deg(5), 21),
			p(52, 21 + deg(80))
		];
		const spans = findLoopSpans(path);
		expect(spans.length).toBeGreaterThan(0);
		const cleaned = removeShortLoops(path);
		expect(cleaned.length).toBeLessThan(path.length);
	});

	test('findCornerWasteSpans flags a wander near a sketch vertex', () => {
		const corner = p(52, 21);
		// Path approaches, loops south of corner, leaves east.
		const path: Point[] = [
			p(52 - deg(50), 21 - deg(50)),
			p(52 - deg(20), 21 - deg(20)),
			p(52, 21), // at corner
			p(52 - deg(80), 21),
			p(52 - deg(120), 21 + deg(40)),
			p(52 - deg(80), 21 + deg(80)),
			p(52 - deg(20), 21 + deg(40)),
			p(52, 21 + deg(20)),
			p(52, 21 + deg(100))
		];
		const spans = findCornerWasteSpans(path, [corner]);
		expect(spans.length).toBeGreaterThan(0);
	});

	test('detects wide corner-approach loops (local detour)', () => {
		// Start, wander south ~170 m, rejoin ~170 m east — path wasteful vs chord.
		const path: Point[] = [p(52, 21)];
		for (let i = 1; i <= 6; i++) path.push(p(52 - deg(i * 28), 21));
		for (let i = 1; i <= 6; i++) path.push(p(52 - deg(168), 21 + deg(i * 28)));
		for (let i = 5; i >= 0; i--) path.push(p(52 - deg(i * 28), 21 + deg(168)));
		path.push(p(52, 21 + deg(180)));
		const spans = findLoopSpans(path);
		expect(spans.length).toBeGreaterThan(0);
	});

	test('prefers a long corner spur over tiny wiggles (severity order)', () => {
		// Micro reverse near start (should lose to the big spur).
		const path: Point[] = [
			p(52, 21),
			p(52 + deg(15), 21),
			p(52, 21),
			p(52 + deg(10), 21)
		];
		// Long out-and-back (Parkowa-style ~200 m spur).
		for (let i = 1; i <= 8; i++) path.push(p(52 - deg(i * 25), 21));
		for (let i = 7; i >= 0; i--) path.push(p(52 - deg(i * 25), 21 + deg(5)));
		// Continue along main street.
		for (let i = 1; i <= 6; i++) path.push(p(52, 21 + deg(i * 40)));

		const spans = findLoopSpans(path);
		expect(spans.length).toBeGreaterThan(0);
		// Largest span should cover most of the long spur, not the 15 m wiggle.
		const biggest = spans.reduce((a, b) =>
			(b.severity ?? 0) > (a.severity ?? 0) ? b : a
		);
		const tipLat = 52 - deg(200);
		const coversTip = path
			.slice(biggest.m, biggest.j + 1)
			.some((pt) => pt.lat <= tipLat + deg(30));
		expect(coversTip).toBe(true);
	});
});

describe('cleanRoutedPathOnNetwork', () => {
	test('returns short paths unchanged', async () => {
		const path = [p(52, 21), p(52.001, 21)];
		expect(await cleanRoutedPathOnNetwork(path, straightBridge)).toHaveLength(2);
	});

	test('re-routes dual-carriageway reverse spur with budgeted bridges', async () => {
		const path: Point[] = [];
		for (let i = 0; i <= 5; i++) {
			path.push(p(52, 21 - degLng(200) + degLng(i * 40)));
		}
		const intersection = path[path.length - 1];
		for (let i = 1; i <= 8; i++) {
			path.push(p(52 - deg(i * 25), intersection.lng));
		}
		const tipLat = 52 - deg(200);
		const east = intersection.lng + degLng(40);
		for (let i = 7; i >= 0; i--) {
			path.push(p(52 - deg(i * 25), east));
		}
		for (let i = 1; i <= 6; i++) {
			path.push(p(52 + deg(i * 30), east));
		}

		const route = vi.fn(straightBridge);
		const cleaned = await cleanRoutedPathOnNetwork(path, route, 8);

		expect(route.mock.calls.length).toBeLessThanOrEqual(8);
		expect(cleaned.length).toBeLessThan(path.length);
		const deepSouth = cleaned.filter((pt) => pt.lat < 52 - deg(100));
		expect(deepSouth.length).toBe(0);
		expect(Math.min(...cleaned.map((pt) => pt.lat))).toBeGreaterThan(tipLat + deg(50));
	});

	test('stops after maxBridges and does not storm', async () => {
		// Many tiny hairpins
		const path: Point[] = [p(52, 21)];
		for (let i = 0; i < 20; i++) {
			path.push(p(52 + deg(20 + (i % 2 === 0 ? 80 : 0)), 21 + degLng(i * 30)));
		}
		const route = vi.fn(straightBridge);
		await cleanRoutedPathOnNetwork(path, route, 3);
		expect(route.mock.calls.length).toBeLessThanOrEqual(3);
	});

	test('collapses zero-chord reverse without needing OSRM', async () => {
		// Out and back to the same point — chord ≈ 0; no network call required.
		const path = [
			p(52, 21),
			p(52 + deg(100), 21),
			p(52 + deg(200), 21),
			p(52 + deg(100), 21),
			p(52, 21),
			p(52, 21 + deg(100))
		];
		const fail: SegmentRouter = async () => null;
		const cleaned = await cleanRoutedPathOnNetwork(path, fail, 8);
		// Tip of the spur should be gone even when the router always fails.
		expect(cleaned.some((pt) => pt.lat >= 52 + deg(180))).toBe(false);
	});

	test('non-zero chord collapse inserts network bridge, not a free gap', async () => {
		// Dual-carriageway style reverse with chord > 2 m between rejoin points.
		const path: Point[] = [p(52, 21)];
		for (let i = 1; i <= 6; i++) path.push(p(52 + deg(i * 30), 21));
		for (let i = 5; i >= 0; i--) path.push(p(52 + deg(i * 30), 21 + degLng(50)));
		path.push(p(52, 21 + degLng(120)));

		const midPoints: Point[] = [];
		const route: SegmentRouter = async (from, to) => {
			const mid = {
				lat: (from.lat + to.lat) / 2,
				lng: (from.lng + to.lng) / 2
			};
			midPoints.push(mid);
			return [from, mid, to];
		};
		const cleaned = await cleanRoutedPathOnNetwork(path, route, 8);
		// Tip gone
		expect(cleaned.some((pt) => pt.lat >= 52 + deg(160))).toBe(false);
		// At least one network mid-point was inserted (not an empty free chord).
		expect(midPoints.length).toBeGreaterThan(0);
		expect(
			cleaned.some((pt) => midPoints.some((m) => Math.abs(pt.lat - m.lat) < 1e-9))
		).toBe(true);
	});

	test('re-routes hairpin apex via network bridge', async () => {
		const path = [p(52, 21), p(52 + deg(100), 21), p(52, 21), p(52, 21 + deg(100))];
		expect(findHairpinApexes(path).length).toBeGreaterThan(0);
		const route = vi.fn(straightBridge);
		const cleaned = await cleanRoutedPathOnNetwork(path, route, 8);
		expect(route).toHaveBeenCalled();
		const hasFarNorth = cleaned.some(
			(pt) => pt.lat >= 52 + deg(90) && Math.abs(pt.lng - 21) < deg(5)
		);
		expect(hasFarNorth).toBe(false);
	});
});

describe('cleanRoutedPath (geometric)', () => {
	test('returns short paths unchanged in length class', () => {
		expect(cleanRoutedPath([p(52, 21), p(52.001, 21)])).toHaveLength(2);
	});
});
