import { distanceBetween } from '$lib/geometry/distance';
import type { Point } from '$lib/types/sketch';
import { TSP_EXACT_LIMIT, TSP_ROAD_COST_LIMIT, TWO_OPT_MAX_ITERATIONS } from '$lib/constants/routing';
import { getDistanceTable } from './osrm';

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
	/** Total transition distance along the chosen path (meters). */
	cost: number;
}

// Entry/exit points for one directed shape state.
// Open: forward entry=first exit=last; reverse swaps.
// Closed full-loop: exit equals entry (start corner of the oriented ring).
export function shapeStateEndpoints(
	first: Point,
	last: Point,
	reversed: boolean,
	closed: boolean
): { entry: Point; exit: Point } {
	if (closed) {
		const start = reversed ? last : first;
		return { entry: start, exit: start };
	}
	return {
		entry: reversed ? last : first,
		exit: reversed ? first : last
	};
}

// Build the 2N×2N GTSP cost matrix (F_i at i, R_i at n+i) from a pairwise
// distance function between exit→entry points.
export function buildFlipTspCosts(
	first: Point[],
	last: Point[],
	closed: boolean[],
	distance: (from: Point, to: Point) => number
): number[][] {
	const n = first.length;
	const SZ = 2 * n;
	const c: number[][] = [];
	for (let i = 0; i < SZ; i++) c.push(new Array(SZ).fill(Infinity));

	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			if (i === j) continue;
			const fI = shapeStateEndpoints(first[i], last[i], false, closed[i] ?? false);
			const rI = shapeStateEndpoints(first[i], last[i], true, closed[i] ?? false);
			const fJ = shapeStateEndpoints(first[j], last[j], false, closed[j] ?? false);
			const rJ = shapeStateEndpoints(first[j], last[j], true, closed[j] ?? false);

			c[i][j] = distance(fI.exit, fJ.entry); // F_i → F_j
			c[i][n + j] = distance(fI.exit, rJ.entry); // F_i → R_j
			c[n + i][j] = distance(rI.exit, fJ.entry); // R_i → F_j
			c[n + i][n + j] = distance(rI.exit, rJ.entry); // R_i → R_j
		}
	}

	// Same-shape F↔R is not a valid mid-tour flip.
	for (let i = 0; i < n; i++) {
		c[i][n + i] = Infinity;
		c[n + i][i] = Infinity;
	}

	return c;
}

export function buildFlipTspHaversineCosts(
	first: Point[],
	last: Point[],
	closed: boolean[] = first.map(() => false)
): number[][] {
	return buildFlipTspCosts(first, last, closed, distanceBetween);
}

// Pure GTSP solve over a prebuilt 2N×2N cost matrix (same encoding as
// buildFlipTspCosts). For N > TSP_EXACT_LIMIT falls back to forward-only
// shape TSP using F_i → F_j submatrix.
export function solveClusterTspWithFlipFromCosts(n: number, cost: number[][]): FlipTspResult {
	if (n === 0) return { order: [], directions: [], cost: 0 };
	if (n === 1) return { order: [0], directions: [false], cost: 0 };

	if (n > TSP_EXACT_LIMIT) {
		// Direction-unaware fallback: F_i → F_j only (top-left n×n block).
		const forward: number[][] = [];
		for (let i = 0; i < n; i++) {
			const row = new Array(n).fill(Infinity);
			for (let j = 0; j < n; j++) {
				if (i !== j) row[j] = cost[i][j];
			}
			forward.push(row);
		}
		const order = solveClusterTsp(forward);
		return { order, directions: order.map(() => false), cost: pathCost(order, forward) };
	}

	const SZ = 2 * n;
	const fullMask = (1 << n) - 1;
	const dp: number[][] = [];
	const parent: number[][] = [];
	for (let m = 0; m <= fullMask; m++) {
		dp.push(new Array(SZ).fill(Infinity));
		parent.push(new Array(SZ).fill(-1));
	}

	for (let k = 0; k < n; k++) {
		dp[1 << k][k] = 0;
		dp[1 << k][n + k] = 0;
	}

	for (let m = 1; m <= fullMask; m++) {
		for (let j = 0; j < SZ; j++) {
			if (dp[m][j] === Infinity) continue;
			const shapeJ = j < n ? j : j - n;
			if ((m & (1 << shapeJ)) === 0) continue;

			const remaining = fullMask ^ m;
			if (remaining === 0) continue;

			for (let k = 0; k < n; k++) {
				if ((remaining & (1 << k)) === 0) continue;
				const newMask = m | (1 << k);
				for (const kNode of [k, n + k]) {
					const newCost = dp[m][j] + cost[j][kNode];
					if (newCost < dp[newMask][kNode]) {
						dp[newMask][kNode] = newCost;
						parent[newMask][kNode] = j;
					}
				}
			}
		}
	}

	let bestEnd = -1;
	let bestCost = Infinity;
	for (let j = 0; j < SZ; j++) {
		if (dp[fullMask][j] < bestCost) {
			bestCost = dp[fullMask][j];
			bestEnd = j;
		}
	}

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

// Solve the open-path Generalized TSP with shape-direction choices.
//
// Each shape has two possible "states":
//   F_i — drawn order (open: entry=first exit=last; closed: entry=exit=first)
//   R_i — reverse     (open: entry=last exit=first; closed: entry=exit=last)
//
// Closed shapes full-loop and leave from the start corner, so transition
// costs use entry=exit for those shapes.
//
// `closed[i]` marks polygon/rectangle shapes. Defaults to all open.
export function solveClusterTspWithFlip(
	first: Point[],
	last: Point[],
	closed: boolean[] = first.map(() => false)
): FlipTspResult {
	const n = first.length;
	if (n === 0) return { order: [], directions: [], cost: 0 };
	if (n === 1) return { order: [0], directions: [false], cost: 0 };

	const cost = buildFlipTspHaversineCosts(first, last, closed);
	return solveClusterTspWithFlipFromCosts(n, cost);
}

// Road-network GTSP costs via OSRM /table. Returns null when N is outside
// [2, TSP_ROAD_COST_LIMIT] or the table call fails — caller uses haversine.
export async function buildFlipTspRoadCosts(
	first: Point[],
	last: Point[],
	closed: boolean[] = first.map(() => false)
): Promise<number[][] | null> {
	const n = first.length;
	if (n < 2 || n > TSP_ROAD_COST_LIMIT) return null;

	// Anchor list: index i = first[i], index n+i = last[i].
	const anchors: Point[] = [...first, ...last];
	try {
		const table = await getDistanceTable(anchors);
		const roadDistance = (from: Point, to: Point) => {
			const fromIdx = anchorIndex(anchors, from);
			const toIdx = anchorIndex(anchors, to);
			if (fromIdx < 0 || toIdx < 0) return distanceBetween(from, to);
			const d = table[fromIdx][toIdx];
			return Number.isFinite(d) ? d : distanceBetween(from, to);
		};
		return buildFlipTspCosts(first, last, closed, roadDistance);
	} catch {
		return null;
	}
}

function anchorIndex(anchors: Point[], p: Point): number {
	// Prefer reference equality (points come from first/last arrays), then
	// exact lat/lng match for closed-state aliases.
	const ref = anchors.indexOf(p);
	if (ref >= 0) return ref;
	return anchors.findIndex((a) => a.lat === p.lat && a.lng === p.lng);
}
