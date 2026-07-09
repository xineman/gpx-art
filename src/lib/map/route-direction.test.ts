import { describe, expect, test } from 'vitest';
import {
	chevronVertices,
	placeChevronsAlongPath,
	type ScreenPoint
} from './route-direction';

const p = (x: number, y: number): ScreenPoint => ({ x, y });

/** Densified polyline: many tiny hops that sum to a long path (city-zoom OSRM). */
function densifiedLine(from: ScreenPoint, to: ScreenPoint, hops: number): ScreenPoint[] {
	const pts: ScreenPoint[] = [from];
	for (let i = 1; i < hops; i++) {
		const t = i / hops;
		pts.push({
			x: from.x + (to.x - from.x) * t,
			y: from.y + (to.y - from.y) * t
		});
	}
	pts.push(to);
	return pts;
}

describe('placeChevronsAlongPath', () => {
	test('returns empty for fewer than 2 points', () => {
		expect(placeChevronsAlongPath([])).toEqual([]);
		expect(placeChevronsAlongPath([p(0, 0)])).toEqual([]);
	});

	test('returns empty when path is shorter than minPathLength', () => {
		expect(
			placeChevronsAlongPath([p(0, 0), p(20, 0)], {
				spacing: 50,
				bearingWindow: 10,
				maxCount: 100,
				startPad: 40,
				endPad: 40,
				minPathLength: 28
			})
		).toEqual([]);
	});

	test('places chevrons at roughly equal spacing on a long horizontal line', () => {
		const points = [p(0, 0), p(400, 0)];
		const placed = placeChevronsAlongPath(points, {
			spacing: 50,
			bearingWindow: 10,
			maxCount: 100,
			startPad: 40,
			endPad: 40,
			minPathLength: 28
		});

		// Placeable up to total - endPad = 360. First at startPad 40, then
		// every 50 → 40, 90, 140, 190, 240, 290, 340 (next 390 > 360).
		expect(placed).toHaveLength(7);
		expect(placed[0].x).toBeCloseTo(40, 5);
		expect(placed[1].x).toBeCloseTo(90, 5);
		expect(placed.every((c) => Math.abs(c.y) < 1e-9)).toBe(true);
		// Travel is east → angle ≈ 0.
		expect(placed.every((c) => Math.abs(c.angle) < 1e-9)).toBe(true);
	});

	test('respects maxCount hard cap', () => {
		const points = [p(0, 0), p(5000, 0)];
		const placed = placeChevronsAlongPath(points, {
			spacing: 20,
			bearingWindow: 5,
			maxCount: 3,
			startPad: 0,
			endPad: 0,
			minPathLength: 10
		});
		expect(placed).toHaveLength(3);
	});

	test('skips zero-length hops without hanging', () => {
		const points = [p(0, 0), p(0, 0), p(300, 0), p(300, 0)];
		const placed = placeChevronsAlongPath(points, {
			spacing: 50,
			bearingWindow: 10,
			maxCount: 50,
			startPad: 40,
			endPad: 40,
			minPathLength: 28
		});
		expect(placed.length).toBeGreaterThan(0);
		expect(placed.every((c) => Number.isFinite(c.angle))).toBe(true);
	});

	test('bearing follows a vertical southbound segment', () => {
		// y increases downward in screen space → south is +y, angle = π/2.
		const points = [p(0, 0), p(0, 400)];
		const placed = placeChevronsAlongPath(points, {
			spacing: 80,
			bearingWindow: 10,
			maxCount: 50,
			startPad: 40,
			endPad: 40,
			minPathLength: 28
		});
		expect(placed.length).toBeGreaterThan(0);
		for (const c of placed) {
			expect(c.angle).toBeCloseTo(Math.PI / 2, 5);
			expect(c.x).toBeCloseTo(0, 5);
		}
	});

	test('still places chevrons on a densified path with sub-pixel edges (city zoom)', () => {
		// 300 px east as 200 hops of 1.5 px — the old minSegment gate would
		// skip every edge and yield zero marks.
		const points = densifiedLine(p(0, 0), p(300, 0), 200);
		const placed = placeChevronsAlongPath(points, {
			spacing: 56,
			bearingWindow: 18,
			maxCount: 120,
			startPad: 40,
			endPad: 40,
			minPathLength: 28
		});
		expect(placed.length).toBeGreaterThanOrEqual(3);
		expect(placed.every((c) => Number.isFinite(c.angle))).toBe(true);
		// Still eastbound overall.
		expect(placed.every((c) => Math.abs(c.angle) < 0.05)).toBe(true);
	});

	test('places at least one chevron on a short on-screen path (pads clamp)', () => {
		// 90 px path: preferred pads of 40+40 would leave only 10 px and the
		// old empty-check would often yield nothing useful. Pads clamp to
		// 22% each → placeable middle still gets a mark.
		const points = [p(0, 0), p(90, 0)];
		const placed = placeChevronsAlongPath(points);
		expect(placed.length).toBeGreaterThanOrEqual(1);
		expect(placed[0].x).toBeGreaterThan(0);
		expect(placed[0].x).toBeLessThan(90);
	});

	test('viewport focuses maxCount on the visible stretch (close zoom)', () => {
		// Long path: without a viewport, maxCount=3 only covers the start.
		// With a viewport over the far end, marks should land there instead.
		const points = [p(0, 0), p(5000, 0)];
		const opts = {
			spacing: 50,
			bearingWindow: 10,
			maxCount: 3,
			startPad: 0,
			endPad: 0,
			minPathLength: 10
		};

		const fromStart = placeChevronsAlongPath(points, opts);
		expect(fromStart).toHaveLength(3);
		expect(fromStart[0].x).toBeCloseTo(0, 5);
		expect(fromStart[2].x).toBeLessThan(200);

		const viewport = { minX: 4000, minY: -50, maxX: 5000, maxY: 50 };
		const fromEnd = placeChevronsAlongPath(points, opts, viewport);
		expect(fromEnd.length).toBeGreaterThanOrEqual(1);
		expect(fromEnd.every((c) => c.x >= 4000 - 1)).toBe(true);
		expect(fromEnd[0].x).toBeGreaterThan(3900);
	});
});

describe('chevronVertices', () => {
	test('tip sits ahead of center along the travel angle', () => {
		const [left, tip, right] = chevronVertices(p(100, 100), 0, 10);
		// angle 0 = east: tip.x > center.x, wings behind.
		expect(tip.x).toBeGreaterThan(100);
		expect(left.x).toBeLessThan(tip.x);
		expect(right.x).toBeLessThan(tip.x);
		// Wings sit on opposite sides of the travel axis.
		expect(left.y).not.toBeCloseTo(right.y, 1);
	});

	test('returns three distinct finite points', () => {
		const verts = chevronVertices(p(0, 0), Math.PI / 4, 8);
		expect(verts).toHaveLength(3);
		for (const v of verts) {
			expect(Number.isFinite(v.x)).toBe(true);
			expect(Number.isFinite(v.y)).toBe(true);
		}
		expect(verts[0]).not.toEqual(verts[1]);
		expect(verts[1]).not.toEqual(verts[2]);
	});
});
