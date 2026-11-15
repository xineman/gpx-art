import { describe, expect, it } from 'vitest';
import { matchAllButTwo, type MatchingResult, type PairCost } from './matching';

function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

function planarCost(points: [number, number][]): PairCost {
	return (left, right) =>
		Math.hypot(points[left]![0] - points[right]![0], points[left]![1] - points[right]![1]);
}

function randomPoints(random: () => number, count: number): [number, number][] {
	return Array.from({ length: count }, () => [random(), random()]);
}

/** Exhaustive minimum over every way to pair `vertices` while skipping `skips` of them. */
function bruteForce(vertices: number[], cost: PairCost, skips: number): number {
	if (vertices.length === 0) return skips === 0 ? 0 : Number.POSITIVE_INFINITY;
	const [first, ...rest] = vertices;
	let best = skips > 0 ? bruteForce(rest, cost, skips - 1) : Number.POSITIVE_INFINITY;
	for (const [index, second] of rest.entries()) {
		const remaining = rest.filter((_, other) => other !== index);
		best = Math.min(best, cost(first!, second) + bruteForce(remaining, cost, skips));
	}
	return best;
}

function expectValid(result: MatchingResult | null, count: number, cost: PairCost) {
	expect(result).not.toBeNull();
	expect(result!.unpaired).toHaveLength(2);
	const covered = [...result!.pairs.flat(), ...result!.unpaired].sort((a, b) => a - b);
	expect(covered).toEqual(Array.from({ length: count }, (_, index) => index));
	const total = result!.pairs.reduce((sum, [left, right]) => sum + cost(left, right), 0);
	expect(result!.cost).toBeCloseTo(total, 9);
}

describe('matchAllButTwo', () => {
	it('leaves the two vertices whose omission saves the most', () => {
		const cost = planarCost([
			[0, 0],
			[1, 0],
			[3, 0],
			[10, 0]
		]);
		const result = matchAllButTwo(4, cost);
		expect(result?.pairs).toEqual([[0, 1]]);
		expect(result?.unpaired).toEqual([2, 3]);
		expect(result?.cost).toBe(1);
		expect(result?.exact).toBe(true);
	});

	it('needs no pairs for zero or two vertices', () => {
		expect(matchAllButTwo(0, () => 5)).toEqual({ pairs: [], unpaired: [], cost: 0, exact: true });
		expect(matchAllButTwo(2, () => 5)).toEqual({
			pairs: [],
			unpaired: [0, 1],
			cost: 0,
			exact: true
		});
	});

	it('rejects an odd vertex count', () => {
		expect(matchAllButTwo(3, () => 1)).toBeNull();
	});

	it('matches the exhaustive optimum exactly', () => {
		const random = seededRandom(7);
		for (let trial = 0; trial < 30; trial++) {
			const count = 4 + 2 * Math.floor(random() * 3);
			const cost = planarCost(randomPoints(random, count));
			const result = matchAllButTwo(count, cost);
			expectValid(result, count, cost);
			const vertices = Array.from({ length: count }, (_, index) => index);
			expect(result!.cost).toBeCloseTo(bruteForce(vertices, cost, 2), 9);
		}
	});

	it('falls back to a valid heuristic matching above the exact limit', () => {
		const random = seededRandom(11);
		for (let trial = 0; trial < 20; trial++) {
			const count = 4 + 2 * Math.floor(random() * 3);
			const cost = planarCost(randomPoints(random, count));
			const result = matchAllButTwo(count, cost, { exactLimit: 0 });
			expectValid(result, count, cost);
			expect(result!.exact).toBe(false);
			const vertices = Array.from({ length: count }, (_, index) => index);
			const optimum = bruteForce(vertices, cost, 2);
			expect(result!.cost).toBeGreaterThanOrEqual(optimum - 1e-9);
			// Pair swaps on small instances stay close to optimal.
			expect(result!.cost).toBeLessThanOrEqual(optimum * 1.5 + 1e-9);
		}
	});
});
