import { describe, expect, it } from 'vitest';
import type { Position } from 'geojson';
import { distanceBetween } from '$lib/geometry/distance';
import { densifySegments, guideToVias, simplifyRdp, strideToMax } from './vias';

function denseLine(n: number): Position[] {
	const pts: Position[] = [];
	for (let i = 0; i < n; i++) {
		// ~11 m steps in lat near 52°N
		pts.push([21, 52 + i * 0.0001]);
	}
	return pts;
}

describe('simplifyRdp', () => {
	it('keeps endpoints of a straight line and drops middles', () => {
		const pts: Position[] = [
			[21, 52],
			[21, 52.001],
			[21, 52.002],
			[21, 52.003]
		];
		const simplified = simplifyRdp(pts, 50);
		expect(simplified[0]).toEqual(pts[0]);
		expect(simplified[simplified.length - 1]).toEqual(pts[pts.length - 1]);
		expect(simplified.length).toBeLessThanOrEqual(pts.length);
		expect(simplified.length).toBe(2);
	});
});

describe('densifySegments', () => {
	it('adds vias to a long straight segment and keeps its endpoints', () => {
		const points: Position[] = [
			[21, 52],
			[21, 52.005]
		];
		const densified = densifySegments(points, false, 20, 120);

		expect(densified[0]).toEqual(points[0]);
		expect(densified[densified.length - 1]).toEqual(points[1]);
		expect(densified.length).toBeGreaterThan(2);
		for (let index = 1; index < densified.length; index++) {
			expect(distanceBetween(densified[index - 1]!, densified[index]!)).toBeLessThanOrEqual(120);
		}
	});

	it('retains rectangle corners and densifies every edge including close', () => {
		const rectangle: Position[] = [
			[21, 52],
			[21.004, 52],
			[21.004, 52.004],
			[21, 52.004]
		];
		const densified = densifySegments(rectangle, true, 60, 120);

		for (const corner of rectangle) expect(densified).toContainEqual(corner);
		expect(densified[0]).toEqual(rectangle[0]);
		expect(densified[densified.length - 1]).toEqual(rectangle[0]);
		expect(densified.filter((point) => point[0] === 21 && point[1] === 52)).toHaveLength(2);
		for (let index = 1; index < densified.length; index++) {
			expect(distanceBetween(densified[index - 1]!, densified[index]!)).toBeLessThanOrEqual(120);
		}
	});

	it('does not add vias to segments already within the target spacing', () => {
		const points: Position[] = [
			[21, 52],
			[21, 52.0005]
		];

		expect(densifySegments(points, false, 20, 120)).toEqual(points);
	});

	it('spends a constrained budget on the longest remaining interval', () => {
		const points: Position[] = [
			[21, 52],
			[21, 52.004],
			[21.002, 52.004]
		];
		const densified = densifySegments(points, false, 4, 120);

		expect(densified).toHaveLength(4);
		expect(densified[1]![0]).toBe(21);
		expect(densified[1]![1]).toBeCloseTo(52.002);
		expect(densified[2]).toEqual(points[1]);
	});
});

describe('strideToMax', () => {
	it('caps length and keeps ends', () => {
		const pts = denseLine(100);
		const capped = strideToMax(pts, 10);
		expect(capped.length).toBeLessThanOrEqual(10);
		expect(capped[0]).toEqual(pts[0]);
		expect(capped[capped.length - 1]).toEqual(pts[pts.length - 1]);
	});
});

describe('guideToVias', () => {
	it('simplifies dense freehand before consistently densifying to the cap', () => {
		const result = guideToVias(
			{ points: denseLine(200), closed: false },
			{ maxVias: 20, toleranceM: 40, sampleSpacingM: 80 }
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.vias).toHaveLength(20);
		expect(result.vias[0]).toEqual(denseLine(200)[0]);
		expect(result.vias[result.vias.length - 1]).toEqual(denseLine(200)[199]);
		expect(result.vias.every((point) => point[0] === 21)).toBe(true);
	});

	it('re-appends start for closed guides', () => {
		const square: Position[] = [
			[21, 52],
			[21.02, 52],
			[21.02, 52.02],
			[21, 52.02]
		];
		const result = guideToVias({ points: square, closed: true }, { maxVias: 20, toleranceM: 5 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		for (const corner of square) expect(result.vias).toContainEqual(corner);
		const first = result.vias[0]!;
		const last = result.vias[result.vias.length - 1]!;
		expect(first[0]).toBe(last[0]);
		expect(first[1]).toBe(last[1]);
		expect(
			result.vias.filter((point) => point[0] === first[0] && point[1] === first[1])
		).toHaveLength(2);
	});

	it('never exceeds the route-wide default cap', () => {
		const result = guideToVias(
			{
				points: [
					[21, 52],
					[21, 52.1]
				],
				closed: false
			},
			{ toleranceM: 5, sampleSpacingM: 20 }
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.vias).toHaveLength(60);
	});

	it('rejects too-short sketches', () => {
		const result = guideToVias({ points: [[21, 52]], closed: false });
		expect(result.ok).toBe(false);
	});
});
