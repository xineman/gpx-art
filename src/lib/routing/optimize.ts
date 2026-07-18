import type { Position } from 'geojson';
import type { ShapeOptimizationProblem, ShapeTraversalCandidate } from './optimization-problem';

export const EXACT_SHAPE_LIMIT = 10;
export const MAX_LOCAL_SEARCH_PASSES = 20;

export type ShapeOptimizationResult =
	| { ok: true; vias: Position[]; connectorDistanceM: number; exact: boolean }
	| { ok: false; error: string };

type PathResult = { candidates: ShapeTraversalCandidate[]; cost: number };

type ExactNode = {
	cost: number;
	previousMask: number;
	previousId: number | null;
};

function samePosition(a: Position, b: Position): boolean {
	return a[0] === b[0] && a[1] === b[1];
}

function matrixIsValid(matrix: (number | null)[][], size: number): boolean {
	return (
		matrix.length === size &&
		matrix.every(
			(row) =>
				row.length === size &&
				row.every((value) => value === null || (Number.isFinite(value) && (value as number) >= 0))
		)
	);
}

function connectorDistance(
	from: ShapeTraversalCandidate,
	to: ShapeTraversalCandidate,
	matrix: (number | null)[][]
): number {
	return matrix[from.exitIndex]![to.entryIndex] ?? Number.POSITIVE_INFINITY;
}

function appendUnique(target: Position[], points: Position[]) {
	for (const point of points) {
		const previous = target.at(-1);
		if (!previous || !samePosition(previous, point)) target.push(point);
	}
}

function flatten(candidates: ShapeTraversalCandidate[]): Position[] {
	const vias: Position[] = [];
	for (const candidate of candidates) appendUnique(vias, candidate.vias);
	return vias;
}

function allCandidates(problem: ShapeOptimizationProblem): ShapeTraversalCandidate[] {
	return problem.shapes.flat();
}

function exactPath(
	problem: ShapeOptimizationProblem,
	matrix: (number | null)[][]
): PathResult | null {
	const shapeCount = problem.shapes.length;
	const fullMask = (1 << shapeCount) - 1;
	const candidates = allCandidates(problem);
	const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
	const layers = Array.from({ length: fullMask + 1 }, () => new Map<number, ExactNode>());

	for (const candidate of candidates) {
		layers[1 << candidate.shapeIndex]!.set(candidate.id, {
			cost: 0,
			previousMask: 0,
			previousId: null
		});
	}

	for (let mask = 1; mask <= fullMask; mask++) {
		for (const [lastId, node] of layers[mask]!) {
			const last = byId.get(lastId)!;
			for (let nextShape = 0; nextShape < shapeCount; nextShape++) {
				const bit = 1 << nextShape;
				if ((mask & bit) !== 0) continue;
				const nextMask = mask | bit;
				for (const next of problem.shapes[nextShape]!) {
					const distance = connectorDistance(last, next, matrix);
					if (!Number.isFinite(distance)) continue;
					const cost = node.cost + distance;
					const existing = layers[nextMask]!.get(next.id);
					if (!existing || cost < existing.cost) {
						layers[nextMask]!.set(next.id, {
							cost,
							previousMask: mask,
							previousId: lastId
						});
					}
				}
			}
		}
	}

	let bestId: number | null = null;
	let bestNode: ExactNode | null = null;
	for (const [candidateId, node] of layers[fullMask]!) {
		if (!bestNode || node.cost < bestNode.cost) {
			bestId = candidateId;
			bestNode = node;
		}
	}
	if (bestId == null || !bestNode) return null;

	const path: ShapeTraversalCandidate[] = [];
	let mask = fullMask;
	let candidateId: number | null = bestId;
	while (candidateId != null) {
		path.push(byId.get(candidateId)!);
		const node: ExactNode = layers[mask]!.get(candidateId)!;
		mask = node.previousMask;
		candidateId = node.previousId;
	}
	path.reverse();
	return { candidates: path, cost: bestNode.cost };
}

/** Pick the best traversal state for every shape in one fixed shape order. */
function bestStatesForOrder(
	order: number[],
	problem: ShapeOptimizationProblem,
	matrix: (number | null)[][]
): PathResult | null {
	let previous = new Map<number, { cost: number; path: ShapeTraversalCandidate[] }>();
	for (const candidate of problem.shapes[order[0]!]!) {
		previous.set(candidate.id, { cost: 0, path: [candidate] });
	}

	for (let orderIndex = 1; orderIndex < order.length; orderIndex++) {
		const next = new Map<number, { cost: number; path: ShapeTraversalCandidate[] }>();
		for (const candidate of problem.shapes[order[orderIndex]!]!) {
			for (const state of previous.values()) {
				const last = state.path[state.path.length - 1]!;
				const distance = connectorDistance(last, candidate, matrix);
				if (!Number.isFinite(distance)) continue;
				const cost = state.cost + distance;
				const existing = next.get(candidate.id);
				if (!existing || cost < existing.cost) {
					next.set(candidate.id, { cost, path: [...state.path, candidate] });
				}
			}
		}
		previous = next;
		if (previous.size === 0) return null;
	}

	let best: { cost: number; path: ShapeTraversalCandidate[] } | null = null;
	for (const state of previous.values()) {
		if (!best || state.cost < best.cost) best = state;
	}
	return best ? { candidates: best.path, cost: best.cost } : null;
}

function greedyOrder(
	start: ShapeTraversalCandidate,
	problem: ShapeOptimizationProblem,
	matrix: (number | null)[][]
): number[] | null {
	const order = [start.shapeIndex];
	const used = new Set(order);
	let current = start;

	while (order.length < problem.shapes.length) {
		let best: ShapeTraversalCandidate | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (let shapeIndex = 0; shapeIndex < problem.shapes.length; shapeIndex++) {
			if (used.has(shapeIndex)) continue;
			for (const candidate of problem.shapes[shapeIndex]!) {
				const distance = connectorDistance(current, candidate, matrix);
				if (distance < bestDistance) {
					best = candidate;
					bestDistance = distance;
				}
			}
		}
		if (!best) return null;
		order.push(best.shapeIndex);
		used.add(best.shapeIndex);
		current = best;
	}
	return order;
}

function orderKey(order: number[]): string {
	return order.join(',');
}

function neighboringOrders(order: number[]): number[][] {
	const neighbors: number[][] = [];
	const seen = new Set<string>();
	const add = (candidate: number[]) => {
		const key = orderKey(candidate);
		if (key === orderKey(order) || seen.has(key)) return;
		seen.add(key);
		neighbors.push(candidate);
	};

	for (let from = 0; from < order.length; from++) {
		const without = order.filter((_, index) => index !== from);
		for (let to = 0; to < order.length; to++) {
			const relocated = [...without];
			relocated.splice(to, 0, order[from]!);
			add(relocated);
		}
	}
	for (let left = 0; left < order.length; left++) {
		for (let right = left + 1; right < order.length; right++) {
			const swapped = [...order];
			[swapped[left], swapped[right]] = [swapped[right]!, swapped[left]!];
			add(swapped);
			add([
				...order.slice(0, left),
				...order.slice(left, right + 1).reverse(),
				...order.slice(right + 1)
			]);
		}
	}
	return neighbors;
}

function heuristicPath(
	problem: ShapeOptimizationProblem,
	matrix: (number | null)[][]
): PathResult | null {
	let best: PathResult | null = null;
	let bestOrder: number[] | null = null;

	for (const start of allCandidates(problem)) {
		const order = greedyOrder(start, problem, matrix);
		if (!order) continue;
		const result = bestStatesForOrder(order, problem, matrix);
		if (result && (!best || result.cost < best.cost)) {
			best = result;
			bestOrder = order;
		}
	}
	if (!best || !bestOrder) return null;

	for (let pass = 0; pass < MAX_LOCAL_SEARCH_PASSES; pass++) {
		let improved: PathResult | null = null;
		let improvedOrder: number[] | null = null;
		for (const order of neighboringOrders(bestOrder)) {
			const result = bestStatesForOrder(order, problem, matrix);
			if (result && result.cost < best.cost && (!improved || result.cost < improved.cost)) {
				improved = result;
				improvedOrder = order;
			}
		}
		if (!improved || !improvedOrder) break;
		best = improved;
		bestOrder = improvedOrder;
	}

	return best;
}

export function optimizeShapeOrder(
	problem: ShapeOptimizationProblem,
	matrix: (number | null)[][]
): ShapeOptimizationResult {
	if (problem.shapes.length === 0) {
		return { ok: false, error: 'No routable shapes in the sketch.' };
	}
	if (!matrixIsValid(matrix, problem.coordinates.length)) {
		return { ok: false, error: 'Couldn’t optimize shape order — invalid bike-distance table.' };
	}
	if (problem.shapes.length === 1) {
		const original = problem.shapes[0]!.find((candidate) => candidate.preferred);
		return {
			ok: true,
			vias: [...(original ?? problem.shapes[0]![0]!).vias],
			connectorDistanceM: 0,
			exact: true
		};
	}

	const exact = problem.shapes.length <= EXACT_SHAPE_LIMIT;
	const result = exact ? exactPath(problem, matrix) : heuristicPath(problem, matrix);
	if (!result) {
		return {
			ok: false,
			error: 'Couldn’t optimize shape order — the bike network does not connect every shape.'
		};
	}
	return {
		ok: true,
		vias: flatten(result.candidates),
		connectorDistanceM: result.cost,
		exact
	};
}
