import { describe, expect, it } from 'vitest';
import type { Position } from 'geojson';
import { EXACT_SHAPE_LIMIT, optimizeShapeOrder } from './optimize';
import {
	buildShapeOptimizationProblem,
	type ShapeOptimizationProblem
} from './optimization-problem';
import type { PreparedRouteShape } from './types';

function open(...xs: number[]): PreparedRouteShape {
	return { closed: false, vias: xs.map((x) => [x, 0]) };
}

function closed(...xs: number[]): PreparedRouteShape {
	return { closed: true, vias: xs.map((x) => [x, 0]) };
}

function distanceMatrix(
	problem: ShapeOptimizationProblem,
	distance: (from: Position, to: Position) => number | null
): (number | null)[][] {
	return problem.coordinates.map((from) => problem.coordinates.map((to) => distance(from, to)));
}

function optimize(
	shapes: PreparedRouteShape[],
	distance: (from: Position, to: Position) => number | null
) {
	const problem = buildShapeOptimizationProblem(shapes);
	return optimizeShapeOrder(problem, distanceMatrix(problem, distance));
}

describe('optimizeShapeOrder', () => {
	it('is independent of feature order and reverses open shapes when beneficial', () => {
		const a = open(0, 1);
		const b = open(10, 11);
		const costs = (from: Position, to: Position) =>
			from[0] === 1 && to[0] === 10 ? 1 : from[0] === to[0] ? 0 : 100;

		const forward = optimize([a, b], costs);
		const reversedInput = optimize([b, a], costs);
		expect(forward).toMatchObject({ ok: true, connectorDistanceM: 1, exact: true });
		expect(reversedInput).toEqual(forward);
		if (!forward.ok) return;
		expect(forward.vias).toEqual([
			[0, 0],
			[1, 0],
			[10, 0],
			[11, 0]
		]);
	});

	it('rotates a closed shape to the lowest-cost sampled anchor', () => {
		const result = optimize([open(0, 1), closed(10, 11, 12, 10)], (from, to) => {
			if (from[0] === to[0]) return 0;
			return from[0] === 1 && to[0] === 11 ? 1 : 100;
		});

		expect(result).toMatchObject({ ok: true, connectorDistanceM: 1 });
		if (!result.ok) return;
		expect(result.vias.slice(0, 2)).toEqual([
			[0, 0],
			[1, 0]
		]);
		expect(result.vias[2]).toEqual([11, 0]);
		expect(result.vias.at(-1)).toEqual([11, 0]);
		expect(
			result.vias
				.slice(2, -1)
				.map((point) => point[0])
				.sort()
		).toEqual([10, 11, 12]);
	});

	it('uses free endpoints and finds the exact global optimum for a greedy trap', () => {
		const shapes = [open(0, 0), open(1, 1), open(2, 2), open(3, 3)];
		const costs = new Map([
			['0>1', 1],
			['1>3', 2],
			['3>2', 1]
		]);
		const result = optimize(shapes, (from, to) => {
			if (from[0] === to[0]) return 0;
			return costs.get(`${from[0]}>${to[0]}`) ?? 20;
		});

		expect(result).toMatchObject({ ok: true, connectorDistanceM: 4, exact: true });
		if (!result.ok) return;
		expect(result.vias.map((point) => point[0])).toEqual([0, 1, 3, 2]);
	});

	it('uses the deterministic heuristic above the exact shape limit', () => {
		const shapes = Array.from({ length: EXACT_SHAPE_LIMIT + 1 }, (_, index) =>
			open(index * 10, index * 10 + 1)
		);
		const run = () => optimize(shapes, (from, to) => Math.abs(from[0]! - to[0]));
		const first = run();
		const second = run();

		expect(first).toMatchObject({ ok: true, exact: false, connectorDistanceM: 90 });
		expect(second).toEqual(first);
		if (!first.ok) return;
		expect(first.vias).toHaveLength(shapes.length * 2);
		const traversed = Array.from({ length: shapes.length }, (_, index) =>
			first.vias
				.slice(index * 2, index * 2 + 2)
				.map((point) => point[0])
				.sort((a, b) => a! - b!)
				.join(',')
		);
		expect(new Set(traversed)).toEqual(
			new Set(shapes.map((shape) => shape.vias.map((point) => point[0]).join(',')))
		);
	});

	it('retains the original traversal for one shape', () => {
		const shape = closed(12, 10, 11, 12);
		const result = optimize([shape], (from, to) => Math.abs(from[0]! - to[0]!));
		expect(result).toMatchObject({ ok: true, connectorDistanceM: 0, exact: true });
		if (!result.ok) return;
		expect(result.vias).toEqual(shape.vias);
	});

	it('deduplicates shared candidate coordinates in the Table problem', () => {
		const problem = buildShapeOptimizationProblem([open(0, 1), open(1, 2)]);
		expect(problem.coordinates).toHaveLength(3);
	});

	it('fails when no directed path can connect every shape', () => {
		const result = optimize([open(0, 1), open(10, 11), open(20, 21)], (from, to) =>
			from[0] === to[0] ? 0 : null
		);
		expect(result).toEqual({
			ok: false,
			error: 'Couldn’t optimize shape order — the bike network does not connect every shape.'
		});
	});

	it('rejects malformed matrices', () => {
		const problem = buildShapeOptimizationProblem([open(0, 1), open(10, 11)]);
		expect(optimizeShapeOrder(problem, [[0]])).toEqual({
			ok: false,
			error: 'Couldn’t optimize shape order — invalid bike-distance table.'
		});
	});
});
