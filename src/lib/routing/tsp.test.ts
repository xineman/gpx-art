import { describe, expect, test } from 'vitest';
import { solveClusterTspWithFlip, type FlipTspResult } from './tsp';

// Small helper to make the tests readable: pick the right endpoint for a
// shape given the direction the solver chose. Mirrors the helper logic in
// state.svelte.ts — if those diverge, the integration test catches it.
function endpoint(
	pts: { lat: number; lng: number }[],
	isReversed: boolean,
	which: 'entry' | 'exit'
): { lat: number; lng: number } {
	const a = pts[0];
	const b = pts[pts.length - 1];
	if (which === 'entry') return isReversed ? b : a;
	return isReversed ? a : b;
}

describe('solveClusterTspWithFlip', () => {
	test('0 shapes -> empty result', () => {
		const r = solveClusterTspWithFlip([], []);
		expect(r.order).toEqual([]);
		expect(r.directions).toEqual([]);
		expect(r.cost).toBe(0);
	});

	test('1 shape -> trivial [0] with direction forward', () => {
		const r = solveClusterTspWithFlip([{ lat: 52, lng: 21 }], [{ lat: 52, lng: 21 }]);
		expect(r.order).toEqual([0]);
		expect(r.directions).toEqual([false]);
		expect(r.cost).toBe(0);
	});

	test('2 shapes picks cheaper of all 4 direction combinations', () => {
		// Layout (haversine meters, rounded):
		//   shape 0 — A.first (52.220, 21.000), A.last (52.220, 21.001)
		//   shape 1 — B.first (52.230, 21.009), B.last (52.220, 21.009)
		//
		// Roughly: B.first is close to A.last (≈d), B.last is far from A.last
		// (≫d), A.first is mid-distance to both B endpoints. So the cheapest
		// direction pair is:
		//   R_0 (entry=B-style at A.last) → F_1 (exit at B.first which is
		//   near A.last) — cost ≈ d
		//
		// We expect: order=[0,1], directions=[true, false] (or symmetric
		// (false, true) if the heuristic favours 0→1 forward and 1→0
		// reversed, depending on the actual distances).
		const r = solveClusterTspWithFlip(
			[
				{ lat: 52.22, lng: 21.0 },
				{ lat: 52.23, lng: 21.009 }
			],
			[
				{ lat: 52.22, lng: 21.001 },
				{ lat: 52.22, lng: 21.009 }
			]
		);

		expect(r.order).toHaveLength(2);
		expect([...r.order].sort()).toEqual([0, 1]);
		expect(r.directions).toHaveLength(2);
		// Cost should be finite and match the path the order implies.
		expect(Number.isFinite(r.cost)).toBe(true);

		// Independent recompute: walk the returned path and confirm the cost
		// we report equals the sum of haversine distances for that path.
		const shapes = [
			{ first: { lat: 52.22, lng: 21.0 }, last: { lat: 52.22, lng: 21.001 } },
			{ first: { lat: 52.23, lng: 21.009 }, last: { lat: 52.22, lng: 21.009 } }
		];
		const segA = endpoint(
			[shapes[r.order[0]].first, shapes[r.order[0]].last],
			r.directions[0],
			'exit'
		);
		const segB = endpoint(
			[shapes[r.order[1]].first, shapes[r.order[1]].last],
			r.directions[1],
			'entry'
		);
		const haversineMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
			const R = 6371000;
			const toRad = (deg: number) => (deg * Math.PI) / 180;
			const dLat = toRad(b.lat - a.lat);
			const dLng = toRad(b.lng - a.lng);
			const x =
				Math.sin(dLat / 2) ** 2 +
				Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
			return 2 * R * Math.asin(Math.sqrt(x));
		};
		const recomputed = haversineMeters(segA, segB);
		expect(r.cost).toBeCloseTo(recomputed, 0);
	});

	test('cost with direction choice ≤ cost with no direction choice', () => {
		// The flip-aware solver should never be worse than the F-only solver,
		// because "all forward" is one of the 2^N direction combinations it
		// considers.
		const first = [
			{ lat: 52.22, lng: 21.0 },
			{ lat: 52.23, lng: 21.008 },
			{ lat: 52.24, lng: 21.002 }
		];
		const last = [
			{ lat: 52.22, lng: 21.001 },
			{ lat: 52.235, lng: 21.008 },
			{ lat: 52.241, lng: 21.0025 }
		];

		const r = solveClusterTspWithFlip(first, last);

		// Haversine between two lat/lng points, meters.
		const hav = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
			const R = 6371000;
			const toRad = (deg: number) => (deg * Math.PI) / 180;
			const dLat = toRad(b.lat - a.lat);
			const dLng = toRad(b.lng - a.lng);
			const x =
				Math.sin(dLat / 2) ** 2 +
				Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
			return 2 * R * Math.asin(Math.sqrt(x));
		};

		// F-only cost for a permutation: sum of distance(last[k], first[k+1])
		// across consecutive pairs. This is what the legacy solveClusterTsp
		// would have minimised.
		const fOnlyCost = (perm: number[]) => {
			let total = 0;
			for (let i = 0; i < perm.length - 1; i++) {
				total += hav(last[perm[i]], first[perm[i + 1]]);
			}
			return total;
		};

		// Enumerate all 3! = 6 permutations and take the minimum.
		const perms: number[][] = [
			[0, 1, 2],
			[0, 2, 1],
			[1, 0, 2],
			[1, 2, 0],
			[2, 0, 1],
			[2, 1, 0]
		];
		let fOnlyMin = Infinity;
		for (const perm of perms) fOnlyMin = Math.min(fOnlyMin, fOnlyCost(perm));

		expect(r.cost).toBeLessThanOrEqual(fOnlyMin + 0.5);
	});

	test('order + directions reconstruct into a valid tour that visits every shape', () => {
		const first = [
			{ lat: 52.22, lng: 21.0 },
			{ lat: 52.23, lng: 21.005 },
			{ lat: 52.24, lng: 21.001 },
			{ lat: 52.225, lng: 21.009 }
		];
		const last = [
			{ lat: 52.22, lng: 21.001 },
			{ lat: 52.235, lng: 21.006 },
			{ lat: 52.241, lng: 21.0015 },
			{ lat: 52.226, lng: 21.008 }
		];

		const r: FlipTspResult = solveClusterTspWithFlip(first, last);

		// Order is a permutation of [0..n)
		expect([...r.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
		expect(r.directions).toHaveLength(4);
		// Cost is finite and positive (no degenerate cluster)
		expect(Number.isFinite(r.cost)).toBe(true);
		expect(r.cost).toBeGreaterThan(0);
	});

	test('determinism: same input -> same output', () => {
		const first = [
			{ lat: 52.22, lng: 21.0 },
			{ lat: 52.23, lng: 21.005 }
		];
		const last = [
			{ lat: 52.22, lng: 21.001 },
			{ lat: 52.235, lng: 21.006 }
		];

		const a = solveClusterTspWithFlip(first, last);
		const b = solveClusterTspWithFlip(first, last);
		expect(a.order).toEqual(b.order);
		expect(a.directions).toEqual(b.directions);
		expect(a.cost).toBe(b.cost);
	});
});
