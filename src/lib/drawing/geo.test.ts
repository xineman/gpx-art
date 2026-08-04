import { describe, expect, it } from 'vitest';
import { closedLineString, isClosedLineString, lineString, rectangleLineString } from './geo';

describe('closedLineString', () => {
	it('repeats the first coordinate without changing the geometry type', () => {
		const geometry = closedLineString([
			[0, 0],
			[10, 0],
			[10, 10]
		]);

		expect(geometry).toEqual({
			type: 'LineString',
			coordinates: [
				[0, 0],
				[10, 0],
				[10, 10],
				[0, 0]
			]
		});
		expect(isClosedLineString(geometry)).toBe(true);
	});

	it('does not append a second closing coordinate', () => {
		const geometry = closedLineString([
			[0, 0],
			[10, 0],
			[0, 0]
		]);

		expect(geometry.coordinates).toHaveLength(3);
	});
});

describe('rectangleLineString', () => {
	it('returns the closed perimeter as a LineString', () => {
		const geometry = rectangleLineString([1, 2], [4, 6]);

		expect(geometry.type).toBe('LineString');
		expect(geometry.coordinates).toEqual([
			[1, 2],
			[4, 2],
			[4, 6],
			[1, 6],
			[1, 2]
		]);
		expect(isClosedLineString(geometry)).toBe(true);
	});
});

describe('isClosedLineString', () => {
	it('rejects an open line', () => {
		expect(
			isClosedLineString(
				lineString([
					[0, 0],
					[1, 1]
				])
			)
		).toBe(false);
	});
});
