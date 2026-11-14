import { describe, expect, it } from 'vitest';
import { intersectSegments, projectPointToSegment } from './planar';

describe('intersectSegments', () => {
	it('finds an interior crossing on both segments', () => {
		const result = intersectSegments(
			{ start: [0, 0], end: [2, 2] },
			{ start: [0, 2], end: [2, 0] }
		);

		expect(result).toEqual({
			kind: 'point',
			left: { t: 0.5, position: [1, 1] },
			right: { t: 0.5, position: [1, 1] }
		});
	});

	it('reports a shared endpoint as a point at the segment ends', () => {
		const result = intersectSegments(
			{ start: [0, 0], end: [1, 0] },
			{ start: [1, 0], end: [1, 1] }
		);

		expect(result).toMatchObject({ kind: 'point', left: { t: 1 }, right: { t: 0 } });
	});

	it('distinguishes collinear overlaps from parallel misses', () => {
		expect(
			intersectSegments({ start: [0, 0], end: [2, 0] }, { start: [1, 0], end: [3, 0] })
		).toEqual({ kind: 'overlap' });
		expect(
			intersectSegments({ start: [0, 0], end: [2, 0] }, { start: [0, 1], end: [2, 1] })
		).toEqual({ kind: 'none' });
	});
});

describe('projectPointToSegment', () => {
	it('clamps to the nearest endpoint and measures the gap in meters', () => {
		const projection = projectPointToSegment([-0.001, 0], { start: [0, 0], end: [0.01, 0] });

		expect(projection.t).toBe(0);
		expect(projection.position).toEqual([0, 0]);
		expect(projection.distanceM).toBeCloseTo(111.32, 1);
	});
});
