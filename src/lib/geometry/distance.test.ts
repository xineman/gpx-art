import { describe, expect, it } from 'vitest';
import { distanceBetween, formatDistance, pathLength } from './distance';

describe('distanceBetween', () => {
	it('returns ~0 for the same point', () => {
		expect(distanceBetween([21.0, 52.2], [21.0, 52.2])).toBeLessThan(0.01);
	});

	it('measures a short Warsaw-scale segment in meters', () => {
		// ~111 m per 0.001° latitude near the equator; at 52°N lat is similar
		const meters = distanceBetween([21.0, 52.2], [21.0, 52.201]);
		expect(meters).toBeGreaterThan(100);
		expect(meters).toBeLessThan(120);
	});
});

describe('pathLength', () => {
	it('sums consecutive segments', () => {
		const a: [number, number] = [21.0, 52.2];
		const b: [number, number] = [21.0, 52.201];
		const c: [number, number] = [21.0, 52.202];
		const total = pathLength([a, b, c]);
		expect(total).toBeCloseTo(distanceBetween(a, b) + distanceBetween(b, c), 5);
	});

	it('returns 0 for fewer than 2 points', () => {
		expect(pathLength([])).toBe(0);
		expect(pathLength([[21, 52]])).toBe(0);
	});
});

describe('formatDistance', () => {
	it('formats meters under 1 km', () => {
		expect(formatDistance(0)).toBe('0 m');
		expect(formatDistance(420.4)).toBe('420 m');
		expect(formatDistance(999)).toBe('999 m');
	});

	it('formats kilometers with one decimal', () => {
		expect(formatDistance(1000)).toBe('1.0 km');
		expect(formatDistance(2450)).toBe('2.5 km');
	});
});
