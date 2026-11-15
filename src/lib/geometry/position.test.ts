import { describe, expect, it } from 'vitest';
import { isClosedRing, positionKey, samePosition } from './position';

describe('position helpers', () => {
	it('compares longitude and latitude exactly, ignoring extra elements', () => {
		expect(samePosition([21, 52], [21, 52, 100])).toBe(true);
		expect(samePosition([21, 52], [21, 52.000001])).toBe(false);
		expect(positionKey([21.5, 52.25])).toBe('21.5,52.25');
	});

	it('detects rings whose last vertex repeats the first', () => {
		expect(
			isClosedRing([
				[0, 0],
				[1, 0],
				[0, 0]
			])
		).toBe(true);
		expect(
			isClosedRing([
				[0, 0],
				[1, 0]
			])
		).toBe(false);
		expect(isClosedRing([[0, 0]])).toBe(false);
	});
});
