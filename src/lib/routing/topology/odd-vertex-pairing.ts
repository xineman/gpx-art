import { TOPOLOGY_EXACT_MATCHING_LIMIT } from '../config';

const COST_EPSILON = 1e-9;
const MAX_PAIR_SWAP_PASSES = 100;
/** Hard ceiling for the 2^n exact table regardless of configuration. */
const MAX_EXACT_VERTICES = 22;

/** Symmetric, finite, non-negative cost of pairing two vertex indexes. */
export type PairCost = (left: number, right: number) => number;

export type MatchingOptions = {
	exactLimit?: number;
};

export type MatchingResult = {
	pairs: [number, number][];
	/** The two vertices left without a partner; empty when there are no vertices. */
	unpaired: number[];
	cost: number;
	exact: boolean;
};

function popcount(value: number): number {
	let bits = value - ((value >>> 1) & 0x55555555);
	bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
	return Math.imul((bits + (bits >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

function lowestBitIndex(mask: number): number {
	return 31 - Math.clz32(mask & -mask);
}

function costMatrix(count: number, cost: PairCost): Float64Array {
	const matrix = new Float64Array(count * count);
	for (let left = 0; left < count; left++) {
		for (let right = left + 1; right < count; right++) {
			const value = cost(left, right);
			matrix[left * count + right] = value;
			matrix[right * count + left] = value;
		}
	}
	return matrix;
}

/**
 * Minimum perfect matching for every vertex subset (`best[mask]` pairs the vertices in `mask`),
 * then the cheapest subset that omits exactly two vertices.
 */
function exactMatching(count: number, matrix: Float64Array): MatchingResult {
	const size = 1 << count;
	const best = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
	const partner = new Int8Array(size).fill(-1);
	best[0] = 0;

	for (let mask = 3; mask < size; mask++) {
		if (popcount(mask) % 2 !== 0) continue;
		const first = lowestBitIndex(mask);
		const rest = mask ^ (1 << first);
		let remaining = rest;
		while (remaining) {
			const bit = remaining & -remaining;
			remaining ^= bit;
			const second = 31 - Math.clz32(bit);
			const cost = best[rest ^ bit]! + matrix[first * count + second]!;
			if (cost < best[mask]!) {
				best[mask] = cost;
				partner[mask] = second;
			}
		}
	}

	const full = size - 1;
	let target = full;
	let unpaired: number[] = [];
	for (let left = 0; left < count; left++) {
		for (let right = left + 1; right < count; right++) {
			const mask = full ^ (1 << left) ^ (1 << right);
			if (!unpaired.length || best[mask]! < best[target]! - COST_EPSILON) {
				target = mask;
				unpaired = [left, right];
			}
		}
	}

	const pairs: [number, number][] = [];
	for (let mask = target; mask;) {
		const first = lowestBitIndex(mask);
		const second = partner[mask]!;
		pairs.push([first, second]);
		mask ^= (1 << first) | (1 << second);
	}
	return { pairs, unpaired, cost: best[target]!, exact: true };
}

/**
 * Greedy pairing improved by swapping partners between two pairs. Two free placeholder vertices
 * stand for the route ends: whoever pairs with one of them stays unpaired.
 */
function heuristicMatching(count: number, matrix: Float64Array): MatchingResult {
	const isPlaceholder = (vertex: number) => vertex >= count;
	const weight = (left: number, right: number) => {
		if (isPlaceholder(left) && isPlaceholder(right)) return Number.POSITIVE_INFINITY;
		if (isPlaceholder(left) || isPlaceholder(right)) return 0;
		return matrix[left * count + right]!;
	};

	const candidates: [number, number][] = [];
	for (let left = 0; left < count; left++) {
		for (let right = left + 1; right < count; right++) candidates.push([left, right]);
	}
	candidates.sort((a, b) => weight(a[0], a[1]) - weight(b[0], b[1]) || a[0] - b[0] || a[1] - b[1]);
	const paired = new Uint8Array(count);
	const pairs: [number, number][] = [];
	for (const [left, right] of candidates) {
		if (paired[left] || paired[right]) continue;
		paired[left] = 1;
		paired[right] = 1;
		pairs.push([left, right]);
	}

	// Release the costliest greedy pair as the route's two ends.
	let costliest = 0;
	for (let index = 1; index < pairs.length; index++) {
		if (weight(...pairs[index]!) > weight(...pairs[costliest]!)) costliest = index;
	}
	const [startEnd, finishEnd] = pairs.splice(costliest, 1)[0]!;
	pairs.push([startEnd, count], [finishEnd, count + 1]);

	for (let pass = 0; pass < MAX_PAIR_SWAP_PASSES; pass++) {
		let improved = false;
		for (let first = 0; first < pairs.length; first++) {
			for (let second = first + 1; second < pairs.length; second++) {
				const [a, b] = pairs[first]!;
				const [c, d] = pairs[second]!;
				const current = weight(a, b) + weight(c, d);
				const crossed = weight(a, c) + weight(b, d);
				const swapped = weight(a, d) + weight(b, c);
				if (crossed < current - COST_EPSILON && crossed <= swapped) {
					pairs[first] = [a, c];
					pairs[second] = [b, d];
					improved = true;
				} else if (swapped < current - COST_EPSILON) {
					pairs[first] = [a, d];
					pairs[second] = [b, c];
					improved = true;
				}
			}
		}
		if (!improved) break;
	}

	const realPairs: [number, number][] = [];
	const unpaired: number[] = [];
	let cost = 0;
	for (const [left, right] of pairs) {
		if (isPlaceholder(left)) unpaired.push(right);
		else if (isPlaceholder(right)) unpaired.push(left);
		else {
			realPairs.push(left < right ? [left, right] : [right, left]);
			cost += weight(left, right);
		}
	}
	unpaired.sort((a, b) => a - b);
	return { pairs: realPairs, unpaired, cost, exact: false };
}

/**
 * Pair vertex indexes `0..count-1` at minimum total cost, leaving the two vertices whose
 * omission saves the most unpaired. Returns `null` for an odd count.
 */
export function matchAllButTwo(
	count: number,
	cost: PairCost,
	options: MatchingOptions = {}
): MatchingResult | null {
	if (count % 2 !== 0) return null;
	if (count <= 2) {
		return {
			pairs: [],
			unpaired: Array.from({ length: count }, (_, index) => index),
			cost: 0,
			exact: true
		};
	}

	const matrix = costMatrix(count, cost);
	const exactLimit = Math.min(
		options.exactLimit ?? TOPOLOGY_EXACT_MATCHING_LIMIT,
		MAX_EXACT_VERTICES
	);
	return count <= exactLimit ? exactMatching(count, matrix) : heuristicMatching(count, matrix);
}
