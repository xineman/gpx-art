import { describe, expect, test } from 'vitest';
import { simplifyRdp } from './simplify';

describe('simplifyRdp', () => {
	test('preserves endpoints of a diagonal pencil stroke', () => {
		const start = { lat: 52.2251, lng: 21.0024 };
		const end = { lat: 52.205, lng: 21.035 };
		const points: { lat: number; lng: number }[] = [];
		for (let i = 0; i < 50; i++) {
			const t = i / 49;
			points.push({
				lat: start.lat + (end.lat - start.lat) * t,
				lng: start.lng + (end.lng - start.lng) * t
			});
		}

		const simplified = simplifyRdp(points, 20);

		// A perfectly straight diagonal has every intermediate vertex on the
		// chord, so RDP should keep only the endpoints.
		expect(simplified[0]).toBe(points[0]);
		expect(simplified.at(-1)).toBe(points.at(-1));
		expect(simplified.length).toBeLessThanOrEqual(4);
	});

	test('keeps widely-spaced zigzag and drops densely-spaced collinear points', () => {
		const start = { lat: 52.22, lng: 21.0 };
		const end = { lat: 52.21, lng: 21.01 };

		// Zigzag where every intermediate vertex swings ~50 m off the chord.
		// RDP must keep every vertex because the perpendicular distance is
		// well outside the 20 m tolerance.
		const zigzag: { lat: number; lng: number }[] = [];
		for (let i = 0; i < 9; i++) {
			const t = i / 8;
			const base = {
				lat: start.lat + (end.lat - start.lat) * t,
				lng: start.lng + (end.lng - start.lng) * t
			};
			const swing = i % 2 === 0 ? 0 : 0.0005;
			zigzag.push({ ...base, lng: base.lng + swing });
		}
		const simplifiedZigzag = simplifyRdp(zigzag, 20);
		expect(simplifiedZigzag.length).toBe(zigzag.length);

		// 30 collinear points spaced ~5.5 m apart lie on the chord from first
		// to last (perpendicular distance = 0). RDP must collapse them to
		// endpoints.
		const dense: { lat: number; lng: number }[] = [];
		for (let i = 0; i < 30; i++) dense.push({ lat: start.lat + i * 0.00005, lng: start.lng });
		const simplifiedDense = simplifyRdp(dense, 20);
		expect(simplifiedDense.length).toBe(2);
		expect(simplifiedDense[0]).toBe(dense[0]);
		expect(simplifiedDense[1]).toBe(dense.at(-1));
	});

	test('passes through inputs shorter than 3 points', () => {
		const start = { lat: 52.22, lng: 21.0 };
		const end = { lat: 52.21, lng: 21.01 };
		expect(simplifyRdp([], 20)).toEqual([]);
		expect(simplifyRdp([start], 20)).toEqual([start]);
		expect(simplifyRdp([start, end], 20)).toHaveLength(2);
	});

	test('reduces a 50-vertex noisy polyline dramatically', () => {
		// Simulates the user's Warsaw-block pencil stroke: ~50 vertices along
		// a diagonal with ±5 m of perpendicular jitter. At 20 m tolerance,
		// only the vertices that visibly change direction should survive —
		// in this case just endpoints plus maybe a few local maxima.
		const points: { lat: number; lng: number }[] = [];
		const start = { lat: 52.2251, lng: 21.0024 };
		const end = { lat: 52.205, lng: 21.035 };
		const N = 50;
		for (let i = 0; i < N; i++) {
			const t = i / (N - 1);
			const jitter = 0.0001 * Math.sin(t * Math.PI * 4);
			points.push({
				lat: start.lat + (end.lat - start.lat) * t + jitter,
				lng: start.lng + (end.lng - start.lng) * t
			});
		}

		const simplified = simplifyRdp(points, 20);

		// Endpoints must always be kept.
		expect(simplified[0]).toBe(points[0]);
		expect(simplified.at(-1)).toBe(points.at(-1));
		// Massive reduction expected.
		expect(simplified.length).toBeLessThan(N / 3);
		expect(simplified.length).toBeGreaterThanOrEqual(2);
	});

	test('does not mutate the input array', () => {
		const start = { lat: 52.22, lng: 21.0 };
		const end = { lat: 52.21, lng: 21.01 };
		const mid = { lat: 52.215, lng: 21.005 };
		const points = [start, mid, end];
		const before = [...points];
		simplifyRdp(points, 20);
		expect(points).toEqual(before);
	});
});
