import { describe, expect, it } from 'vitest';
import type { Position } from 'geojson';
import { guideToVias, sampleAlongPath, simplifyRdp, strideToMax } from './vias';

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

describe('sampleAlongPath', () => {
	it('keeps first and last', () => {
		const pts = denseLine(50);
		const sampled = sampleAlongPath(pts, 100);
		expect(sampled[0]).toEqual(pts[0]);
		expect(sampled[sampled.length - 1]).toEqual(pts[pts.length - 1]);
		expect(sampled.length).toBeGreaterThan(2);
		expect(sampled.length).toBeLessThan(pts.length);
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
	it('returns vias within max and keeps ends', () => {
		const result = guideToVias(
			{ points: denseLine(200), closed: false },
			{ maxVias: 20, toleranceM: 40, sampleSpacingM: 80 }
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.vias.length).toBeGreaterThanOrEqual(2);
		expect(result.vias.length).toBeLessThanOrEqual(20);
		expect(result.vias[0]).toEqual(denseLine(200)[0]);
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
		const first = result.vias[0]!;
		const last = result.vias[result.vias.length - 1]!;
		expect(first[0]).toBe(last[0]);
		expect(first[1]).toBe(last[1]);
	});

	it('rejects too-short sketches', () => {
		const result = guideToVias({ points: [[21, 52]], closed: false });
		expect(result.ok).toBe(false);
	});
});
