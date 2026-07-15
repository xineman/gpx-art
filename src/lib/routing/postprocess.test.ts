import { describe, expect, it } from 'vitest';
import type { Position } from 'geojson';
import { ensureClosedLoop, stitchCoordinates } from './postprocess';

describe('stitchCoordinates', () => {
	it('joins parts without duplicating shared vertices', () => {
		const a: Position[] = [
			[0, 0],
			[1, 1]
		];
		const b: Position[] = [
			[1, 1],
			[2, 2]
		];
		expect(stitchCoordinates([a, b])).toEqual([
			[0, 0],
			[1, 1],
			[2, 2]
		]);
	});
});

describe('ensureClosedLoop', () => {
	it('appends start when ends are far', () => {
		const pts: Position[] = [
			[21, 52],
			[21.05, 52],
			[21.05, 52.05]
		];
		const closed = ensureClosedLoop(pts, true, 25);
		expect(closed[closed.length - 1]).toEqual(pts[0]);
	});

	it('is a no-op when not closed', () => {
		const pts: Position[] = [
			[21, 52],
			[21.05, 52]
		];
		expect(ensureClosedLoop(pts, false)).toEqual(pts);
	});
});
