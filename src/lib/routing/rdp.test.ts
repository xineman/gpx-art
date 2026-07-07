import { describe, expect, test } from 'vitest';
import { simplifyRdp } from './rdp';

const p = (lat: number, lng: number) => ({ lat, lng });

describe('simplifyRdp', () => {
	test('returns the input untouched for fewer than 3 points', () => {
		const a = p(52, 21);
		const b = p(52.001, 21);

		expect(simplifyRdp([a, b], 10)).toEqual([a, b]);
		expect(simplifyRdp([a], 10)).toEqual([a]);
		expect(simplifyRdp([], 10)).toEqual([]);
	});

	test('drops colinear interior points along a straight edge', () => {
		// 10 points on the same horizontal line. Every interior point is
		// exactly on the chord between the two endpoints, so RDP keeps
		// just the endpoints.
		const points = Array.from({ length: 10 }, (_, i) => p(52, 21 + i * 0.0001));

		expect(simplifyRdp(points, 10)).toEqual([points[0], points[9]]);
	});

	test('preserves a sharp outlier pushed perpendicular to a straight edge', () => {
		// 10 colinear points with the middle one kicked 100 m north.
		// The outlier's perpendicular distance is well above the 10 m
		// tolerance, so it must survive simplification.
		const points = Array.from({ length: 10 }, (_, i) => p(52, 21 + i * 0.0001));
		points[5] = p(52.001, 21.0005); // ~100 m north of the chord

		const simplified = simplifyRdp(points, 10);

		expect(simplified.length).toBeGreaterThanOrEqual(3);
		expect(simplified).toContainEqual(points[5]);
		expect(simplified[0]).toEqual(points[0]);
		expect(simplified.at(-1)).toEqual(points[9]);
	});

	test('keeps all points when each interior point bows beyond tolerance', () => {
		// 3 points where the middle is pushed ~68 m east of the chord.
		// With 10 m tolerance, every interior point survives.
		const a = p(52, 21);
		const m = p(52.0005, 21.001);
		const b = p(52.001, 21);

		expect(simplifyRdp([a, m, b], 10)).toEqual([a, m, b]);
	});

	test('keeps every corner of a zig-zag that bows beyond tolerance', () => {
		// Alternating 50 m jogs north/south — every interior point is
		// far from the chord between the endpoints, so none are dropped.
		const points = [
			p(52, 21),
			p(52.0005, 21.0001),
			p(52, 21.0002),
			p(52.0005, 21.0003),
			p(52, 21.0004)
		];

		expect(simplifyRdp(points, 10)).toEqual(points);
	});

	test('does not collapse a degenerate chord to itself', () => {
		// Two points at the same location — the chord has zero length, so
		// perpendicularDistance falls back to distanceBetween. With no
		// interior points to consider, the result is the input.
		const a = p(52, 21);

		expect(simplifyRdp([a, a], 10)).toEqual([a, a]);
	});

	test('rejects non-positive tolerance', () => {
		expect(() => simplifyRdp([p(52, 21), p(52.001, 21)], 0)).toThrow('greater than 0');
		expect(() => simplifyRdp([p(52, 21), p(52.001, 21)], -1)).toThrow('greater than 0');
	});
});
