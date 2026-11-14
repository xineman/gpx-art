import { describe, expect, it } from 'vitest';
import type { Position } from 'geojson';
import { distanceBetween } from '#lib/geometry/distance.js';
import type { GuideWalk } from './types';
import { allocateWalkVias } from './vias';

/** About 11 m per unit northward and 7 m per unit eastward near 52°N. */
function at(x: number, y: number): Position {
	return [21 + x * 0.0001, 52 + y * 0.0001];
}

function walk(points: Position[], mandatory = [0, points.length - 1]): GuideWalk {
	const first = points[0]!;
	const last = points[points.length - 1]!;
	return { points, mandatory, closed: first[0] === last[0] && first[1] === last[1] };
}

function allocate(walks: GuideWalk[], maxVias: number, sampleSpacingM = 10_000) {
	const result = allocateWalkVias(walks, { maxVias, toleranceM: 30, sampleSpacingM });
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.error);
	return result.vias;
}

function maxInterval(vias: Position[]): number {
	return Math.max(...vias.slice(1).map((point, index) => distanceBetween(vias[index]!, point)));
}

describe('allocateWalkVias', () => {
	it('simplifies a dense straight stroke to its ends', () => {
		const line = Array.from({ length: 200 }, (_, index) => at(0, index));
		expect(allocate([walk(line)], 20)).toEqual([[line[0], line[199]]]);
	});

	it('keeps mandatory junction passes and dead-end tips inside the tolerance', () => {
		// Junction J at the middle of a straight line, with a short spur to T retraced from J.
		const points = [at(0, 0), at(0, 5), at(1, 5), at(0, 5), at(0, 10)];
		expect(allocate([walk(points, [0, 1, 2, 3, 4])], 20)).toEqual([points]);
	});

	it('keeps the farthest point of a loop that returns to its start', () => {
		const square = [at(0, 0), at(1, 0), at(1, 1), at(0, 1), at(0, 0)];
		expect(allocate([walk(square)], 20)).toEqual([[at(0, 0), at(1, 1), at(0, 0)]]);
	});

	it('spends a shared budget on the most deviating bend across walks', () => {
		const sharp = walk([at(0, 0), at(20, 40), at(40, 0)]);
		const gentle = walk([at(100, 0), at(120, 5), at(140, 0)]);
		expect(allocate([gentle, sharp], 5)).toEqual([
			[at(100, 0), at(140, 0)],
			[at(0, 0), at(20, 40), at(40, 0)]
		]);
		expect(allocate([gentle, sharp], 6)).toEqual([gentle.points, sharp.points]);
	});

	it('densifies the longest intervals across walks with the spare budget', () => {
		const short = walk([at(0, 0), at(0, 50)]);
		const long = walk([at(10, 0), at(10, 150)]);
		const vias = allocate([short, long], 10, 120);

		expect(vias.flat()).toHaveLength(10);
		expect(vias.map((line) => [line[0], line.at(-1)])).toEqual([short.points, long.points]);
		expect(maxInterval(vias[1]!)).toBeLessThan(maxInterval(vias[0]!) * 1.01);
	});

	it('stops densifying once every interval is within the sample spacing', () => {
		const vias = allocate([walk([at(0, 0), at(0, 50)])], 60, 120);
		expect(vias[0]!.length).toBeLessThan(60);
		expect(maxInterval(vias[0]!)).toBeLessThanOrEqual(120);
	});

	it('rejects walks whose mandatory points exceed the cap', () => {
		const points = Array.from({ length: 6 }, (_, index) => at(index * 100, 0));
		expect(allocateWalkVias([walk(points, [0, 1, 2, 3, 4, 5])], { maxVias: 5 })).toEqual({
			ok: false,
			error: 'Too many shapes and junctions to route at once (max 5 waypoints).'
		});
	});
});
