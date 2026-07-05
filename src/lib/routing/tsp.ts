import { distanceBetween } from '$lib/geometry/distance';
import type { Point } from '$lib/types/sketch';
import { TSP_EXACT_LIMIT, TWO_OPT_MAX_ITERATIONS } from '$lib/constants/routing';

// Solve an open-path TSP over a square distance matrix.
//
// `costs[i][j]` is the cost of going from cluster i to cluster j (Infinity for
// i == j). The function returns a permutation of indices that minimizes total
// transition cost while starting at vertex 0 — i.e. the optimal order to visit
// clusters when we are free to choose where to start.
//
// For N ≤ TSP_EXACT_LIMIT we use the exact Held-Karp bitmask DP (O(N²·2ᴺ),
// ~3M ops at N=14 — comfortably fast in the browser). Past that limit we fall
// back to a nearest-neighbour heuristic seeded from every vertex, then 2-opt
// improvement with an iteration cap as a safety net.
export function solveClusterTsp(costs: number[][]): number[] {
	const n = costs.length;
	if (n === 0) return [];
	if (n === 1) return [0];

	if (n <= TSP_EXACT_LIMIT) {
		return heldKarp(costs);
	}

	// Heuristic: try NN from every starting vertex, run 2-opt on each, keep the
	// best. Multi-start is cheap and dramatically improves quality vs single-NN.
	let best: number[] = [];
	let bestCost = Infinity;
	for (let start = 0; start < n; start++) {
		const candidate = twoOpt(nearestNeighbor(costs, start), costs);
		const cost = pathCost(candidate, costs);
		if (cost < bestCost) {
			bestCost = cost;
			best = candidate;
		}
	}
	return best;
}

function heldKarp(costs: number[][]): number[] {
	const n = costs.length;
	const fullMask = (1 << n) - 1;

	// dp[mask][j] = minimum cost of a path starting at vertex 0, visiting every
	// vertex in `mask`, ending at j. Only meaningful when 0 ∈ mask.
	const dp: number[][] = [];
	const parent: number[][] = [];
	for (let mask = 0; mask <= fullMask; mask++) {
		dp.push(new Array(n).fill(Infinity));
		parent.push(new Array(n).fill(-1));
	}

	// Base case: visit only vertex 0, end at 0, cost 0.
	dp[1 << 0][0] = 0;

	// We can iterate in integer order: for any (mask, j), prevMask = mask ^ (1<<j)
	// is strictly less than mask (we removed one set bit), so it's been computed
	// already.
	for (let mask = 1; mask <= fullMask; mask++) {
		if (!(mask & 1)) continue; // mask must contain vertex 0
		for (let j = 1; j < n; j++) {
			if (!(mask & (1 << j))) continue;
			const prevMask = mask ^ (1 << j);

			let bestPrev = -1;
			let bestCost = Infinity;
			for (let i = 0; i < n; i++) {
				if (!(prevMask & (1 << i))) continue;
				const candidate = dp[prevMask][i] + costs[i][j];
				if (candidate < bestCost) {
					bestCost = candidate;
					bestPrev = i;
				}
			}

			if (bestPrev !== -1) {
				dp[mask][j] = bestCost;
				parent[mask][j] = bestPrev;
			}
		}
	}

	// Pick the cheapest endpoint (open path — no return-to-start).
	let end = -1;
	let endCost = Infinity;
	for (let j = 1; j < n; j++) {
		if (dp[fullMask][j] < endCost) {
			endCost = dp[fullMask][j];
			end = j;
		}
	}
	if (end === -1) return [0]; // only happens for n === 1; handled upstream

	// Reconstruct by walking parent pointers backwards.
	const order: number[] = [];
	let mask = fullMask;
	let cur: number = end;
	while (cur !== -1) {
		order.unshift(cur);
		const prev = parent[mask][cur];
		mask ^= 1 << cur;
		cur = prev;
	}
	return order;
}

function nearestNeighbor(costs: number[][], start: number): number[] {
	const n = costs.length;
	const visited = new Array(n).fill(false);
	visited[start] = true;
	const order = [start];
	let current = start;

	for (let step = 1; step < n; step++) {
		let next = -1;
		let bestCost = Infinity;
		for (let j = 0; j < n; j++) {
			if (visited[j]) continue;
			if (costs[current][j] < bestCost) {
				bestCost = costs[current][j];
				next = j;
			}
		}
		if (next === -1) break;
		visited[next] = true;
		order.push(next);
		current = next;
	}
	return order;
}

function twoOpt(order: number[], costs: number[][]): number[] {
	const n = order.length;
	if (n < 4) return [...order];

	const arr = [...order];
	let improved = true;
	let iter = 0;

	while (improved && iter < TWO_OPT_MAX_ITERATIONS) {
		improved = false;
		iter++;

		for (let i = 0; i < n - 2; i++) {
			// k ranges to n-2 so order[k+1] (the last vertex) is always valid
			// for an open path — we never wrap around to index 0.
			for (let k = i + 2; k < n - 1; k++) {
				const a = arr[i];
				const b = arr[i + 1];
				const c = arr[k];
				const d = arr[k + 1];

				const original = costs[a][b] + costs[c][d];
				const swapped = costs[a][c] + costs[b][d];

				if (swapped < original) {
					// Reverse the segment between i+1 and k in place.
					let left = i + 1;
					let right = k;
					while (left < right) {
						[arr[left], arr[right]] = [arr[right], arr[left]];
						left++;
						right--;
					}
					improved = true;
				}
			}
		}
	}

	return arr;
}

function pathCost(order: number[], costs: number[][]): number {
	let total = 0;
	for (let i = 0; i < order.length - 1; i++) {
		total += costs[order[i]][order[i + 1]];
	}
	return total;
}

export interface FlipTspResult {
	/** Optimal shape visit order — indices into the input first/last arrays. */
	order: number[];
	/** `directions[i]` is `true` if the i-th visited shape should be routed in reverse. */
	directions: boolean[];
	/** Total transition distance along the chosen path (haversine meters). */
	cost: number;
}

// Solve the open-path Generalized TSP with shape-direction choices.
//
// Each shape has two possible "states":
//   F_i — traced in drawn order:  entry = first[i], exit = last[i]
//   R_i — traced in reverse order: entry = last[i],  exit = first[i]
//
// We pick exactly one state per shape, and an order to visit them, that
// minimizes the total transition distance. Transition cost between any
// two states is the haversine distance between the corresponding
// endpoints. Internal shape cost is assumed independent of direction —
// OSRM `/route` length is similar whether the same vertex set is visited
// forward or backward, modulo minor asymmetries in left/right turns at
// intersections; a small effect dwarfed by the inter-shape transitions.
//
// State encoding for the DP:
//   - mask : N bits. Bit k is set iff we've committed to a direction for
//     shape k.
//   - j    : 0 ≤ j < 2N. j < N means we ended at F_j; j ≥ N means we ended
//     at R_(j-N).
//
// The DP always has 2N "ending nodes" available, but a valid mask covers
// exactly N shapes (one per pair {F_i, R_i}). Total states: 2^N · 2N —
// same exponential as the plain TSP, just one extra factor of 2 from the
// direction doubling. For N = 14 that's ~460k states and ~6M transitions
// — well under a second in the browser.
//
// For N > TSP_EXACT_LIMIT we degrade to the existing `solveClusterTsp`
// over the directional cost matrix (all shapes forward). This isn't
// optimal — it loses the direction choice — but it's a safe, monotone
// fallback until a GTSP heuristic lands.
export function solveClusterTspWithFlip(first: Point[], last: Point[]): FlipTspResult {
	const n = first.length;
	if (n === 0) return { order: [], directions: [], cost: 0 };
	if (n === 1) return { order: [0], directions: [false], cost: 0 };

	if (n > TSP_EXACT_LIMIT) {
		// Direction-unaware fallback. Same F_i → F_j cost matrix the old
		// solver used, run through the existing entry point.
		const cost = last.map((_, i) =>
			first.map((_, j) => (i === j ? Infinity : distanceBetween(last[i], first[j])))
		);
		const order = solveClusterTsp(cost);
		return { order, directions: order.map(() => false), cost: pathCost(order, cost) };
	}

	// Build the 2N x 2N cost matrix.
	//   F_i lives at index i      (i < n)
	//   R_i lives at index n + i  (i < n)
	const SZ = 2 * n;
	const c: number[][] = [];
	for (let i = 0; i < SZ; i++) c.push(new Array(SZ).fill(Infinity));
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			if (i === j) continue;
			c[i][j] = distanceBetween(last[i], first[j]); // F_i → F_j
			c[i][n + j] = distanceBetween(last[i], last[j]); // F_i → R_j
			c[n + i][j] = distanceBetween(first[i], first[j]); // R_i → F_j
			c[n + i][n + j] = distanceBetween(first[i], last[j]); // R_i → R_j
		}
	}
	// F_i → R_i and R_i → F_i would mean "visit the same shape mid-tour
	// and flip its direction", which isn't in our model. Mark unreachable.
	for (let i = 0; i < n; i++) {
		c[i][n + i] = Infinity;
		c[n + i][i] = Infinity;
	}

	// dp[mask][j] = min-cost open path starting at any node, visiting
	// every shape in `mask`, ending at node j.
	const fullMask = (1 << n) - 1;
	const dp: number[][] = [];
	const parent: number[][] = [];
	for (let m = 0; m <= fullMask; m++) {
		dp.push(new Array(SZ).fill(Infinity));
		parent.push(new Array(SZ).fill(-1));
	}

	// Base case: any single shape can be started at either of its two
	// direction-states with zero cost. After this, masks strictly grow.
	for (let k = 0; k < n; k++) {
		dp[1 << k][k] = 0; // start at F_k
		dp[1 << k][n + k] = 0; // start at R_k
	}

	// Iterate masks in integer order — every predecessor of (mask, j) lives
	// in a smaller mask (we remove one shape to extend), so its dp entry
	// has already been computed by the time we reach (mask, j).
	for (let m = 1; m <= fullMask; m++) {
		for (let j = 0; j < SZ; j++) {
			if (dp[m][j] === Infinity) continue;
			const shapeJ = j < n ? j : j - n;
			if ((m & (1 << shapeJ)) === 0) continue;

			const remaining = fullMask ^ m;
			if (remaining === 0) continue;

			// Extend with any not-yet-visited shape, in either direction.
			for (let k = 0; k < n; k++) {
				if ((remaining & (1 << k)) === 0) continue;
				const newMask = m | (1 << k);
				for (const kNode of [k, n + k]) {
					const newCost = dp[m][j] + c[j][kNode];
					if (newCost < dp[newMask][kNode]) {
						dp[newMask][kNode] = newCost;
						parent[newMask][kNode] = j;
					}
				}
			}
		}
	}

	// The optimal tour ends at whichever node minimises the full-mask cost.
	let bestEnd = -1;
	let bestCost = Infinity;
	for (let j = 0; j < SZ; j++) {
		if (dp[fullMask][j] < bestCost) {
			bestCost = dp[fullMask][j];
			bestEnd = j;
		}
	}

	// Walk parent pointers backward. Each step peels the current node's
	// shape out of the mask; we record the shape index and its direction
	// (R_ if the node index was ≥ n) in reverse so the unshifted sequence
	// reads in visit order.
	const order: number[] = [];
	const directions: boolean[] = [];
	let curMask = fullMask;
	let cur = bestEnd;
	while (cur !== -1) {
		const shapeIdx = cur < n ? cur : cur - n;
		order.unshift(shapeIdx);
		directions.unshift(cur >= n);
		const prev = parent[curMask][cur];
		curMask ^= 1 << shapeIdx;
		cur = prev;
	}

	return { order, directions, cost: bestCost };
}
