import { describe, expect, it } from 'vitest';
import type { Position } from 'geojson';
import { distanceBetween } from '#lib/geometry/distance.js';
import type { GuidePath } from '../preparation/types';
import { buildTopologyGraph, type TopologyGraph } from './build-graph';
import {
	connectedComponents,
	planTopologyTraversals,
	traversalPositions,
	type TopologyTraversal,
	type TraversalOptions
} from './postman';

const ORIGIN: Position = [21, 52.2];
const STEP = 0.001;

function at(x: number, y: number): Position {
	return [ORIGIN[0]! + x * STEP, ORIGIN[1]! + y * STEP];
}

function open(...points: Position[]): GuidePath {
	return { points, closed: false };
}

function closed(...points: Position[]): GuidePath {
	return { points, closed: true };
}

/** Exact noding only, so tests control every connection. */
function graphFor(guides: GuidePath[]): TopologyGraph {
	return buildTopologyGraph(guides, { snapToleranceM: 0 });
}

function nodeIdAt(graph: TopologyGraph, position: Position): number {
	const node = graph.nodes.find(
		(candidate) => distanceBetween(candidate.position, position) < 1e-6
	);
	if (!node) throw new Error(`No node at ${position.join(',')}`);
	return node.id;
}

function edgeLength(graph: TopologyGraph, edgeId: number): number {
	const edge = graph.edges[edgeId]!;
	return distanceBetween(
		graph.nodes[edge.fromNodeId]!.position,
		graph.nodes[edge.toNodeId]!.position
	);
}

/** Single traversal of a one-component drawing, checked for continuity and full coverage. */
function plan(graph: TopologyGraph, options: TraversalOptions = {}): TopologyTraversal {
	const traversals = planTopologyTraversals(graph, options);
	expect(traversals).toHaveLength(1);
	expectValidTraversal(
		graph,
		traversals[0]!,
		graph.edges.map((edge) => edge.id)
	);
	return traversals[0]!;
}

function expectValidTraversal(
	graph: TopologyGraph,
	traversal: TopologyTraversal,
	edgeIds: number[]
) {
	const { steps } = traversal;
	expect(steps.length).toBeGreaterThan(0);
	expect(steps[0]!.fromNodeId).toBe(traversal.startNodeId);
	expect(steps.at(-1)!.toNodeId).toBe(traversal.endNodeId);

	const seen = new Set<number>();
	let walkedM = 0;
	for (const [index, step] of steps.entries()) {
		if (index > 0) expect(step.fromNodeId).toBe(steps[index - 1]!.toNodeId);
		const edge = graph.edges[step.edgeId]!;
		expect([edge.fromNodeId, edge.toNodeId].sort()).toEqual(
			[step.fromNodeId, step.toNodeId].sort()
		);
		expect(step.repeated).toBe(seen.has(step.edgeId));
		seen.add(step.edgeId);
		walkedM += edgeLength(graph, step.edgeId);
	}

	expect([...seen].sort((a, b) => a - b)).toEqual(edgeIds);
	const drawnM = edgeIds.reduce((total, edgeId) => total + edgeLength(graph, edgeId), 0);
	expect(traversal.drawnLengthM).toBeCloseTo(drawnM, 6);
	expect(walkedM).toBeCloseTo(traversal.drawnLengthM + traversal.repeatedLengthM, 6);
	expect(traversalPositions(graph, traversal)).toHaveLength(steps.length + 1);
}

function repeatedEdgeIds(traversal: TopologyTraversal): number[] {
	return traversal.steps
		.filter((step) => step.repeated)
		.map((step) => step.edgeId)
		.sort((a, b) => a - b);
}

function endpoints(traversal: TopologyTraversal): number[] {
	return [traversal.startNodeId, traversal.endNodeId].sort((a, b) => a - b);
}

describe('connectedComponents', () => {
	it('separates disconnected drawings and joins touching ones', () => {
		const graph = graphFor([
			closed(at(0, 0), at(1, 0), at(1, 1), at(0, 1)),
			open(at(1, 1), at(2, 2)),
			open(at(10, 10), at(11, 10))
		]);
		const components = connectedComponents(graph);
		expect(components.map((component) => component.edgeIds.length)).toEqual([5, 1]);
		expect(components.flatMap((component) => component.edgeIds).sort((a, b) => a - b)).toEqual(
			graph.edges.map((edge) => edge.id)
		);
	});
});

describe('planTopologyTraversals', () => {
	it('walks a closed shape once and returns to its start', () => {
		const graph = graphFor([closed(at(0, 0), at(2, 0), at(2, 2), at(0, 2))]);
		const traversal = plan(graph);
		expect(traversal.startNodeId).toBe(traversal.endNodeId);
		expect(traversal.repeatedLengthM).toBe(0);
	});

	it('rides a lone stroke once from end to end', () => {
		const graph = graphFor([open(at(0, 0), at(1, 0), at(3, 1))]);
		const traversal = plan(graph);
		expect(endpoints(traversal)).toEqual(
			[nodeIdAt(graph, at(0, 0)), nodeIdAt(graph, at(3, 1))].sort((a, b) => a - b)
		);
		expect(traversal.repeatedLengthM).toBe(0);
	});

	it('retraces only the shortest T-junction branch', () => {
		const graph = graphFor([open(at(-3, 0), at(3, 0)), open(at(0, 0), at(0, 1))]);
		const stemEdgeId = graph.edges.find(
			(edge) =>
				[edge.fromNodeId, edge.toNodeId].includes(nodeIdAt(graph, at(0, 1))) &&
				[edge.fromNodeId, edge.toNodeId].includes(nodeIdAt(graph, at(0, 0)))
		)!.id;

		const traversal = plan(graph);
		expect(endpoints(traversal)).toEqual(
			[nodeIdAt(graph, at(-3, 0)), nodeIdAt(graph, at(3, 0))].sort((a, b) => a - b)
		);
		expect(repeatedEdgeIds(traversal)).toEqual([stemEdgeId]);
	});

	it('starts and finishes at the tips of the two longest rays', () => {
		const tips = { east: at(5, 0), west: at(-2, 0), north: at(0, 4), south: at(0, -1) };
		const graph = graphFor([open(tips.west, tips.east), open(tips.south, tips.north)]);
		const center = at(0, 0);
		const rayLength = (tip: Position) => distanceBetween(center, tip);
		// Two shortest rays by ground distance (longitude degrees are shorter at this latitude).
		expect(rayLength(tips.south)).toBeLessThan(rayLength(tips.west));
		expect(rayLength(tips.west)).toBeLessThan(rayLength(tips.east));
		expect(rayLength(tips.east)).toBeLessThan(rayLength(tips.north));

		const traversal = plan(graph);
		expect(endpoints(traversal)).toEqual(
			[nodeIdAt(graph, tips.east), nodeIdAt(graph, tips.north)].sort((a, b) => a - b)
		);
		expect(traversal.repeatedLengthM).toBeCloseTo(rayLength(tips.south) + rayLength(tips.west), 6);
	});

	it('rides a loop with a tail without retracing', () => {
		const corner = at(2, 2);
		const tip = at(4, 4);
		const graph = graphFor([closed(at(0, 0), at(2, 0), corner, at(0, 2)), open(corner, tip)]);
		const traversal = plan(graph);
		expect(endpoints(traversal)).toEqual(
			[nodeIdAt(graph, corner), nodeIdAt(graph, tip)].sort((a, b) => a - b)
		);
		expect(traversal.repeatedLengthM).toBe(0);
	});

	it('rides straight through a self-intersection', () => {
		const crossing = at(1, 1);
		const graph = graphFor([closed(at(0, 0), at(2, 2), at(2, 0), at(0, 2))]);
		const crossingId = nodeIdAt(graph, crossing);
		const traversal = plan(graph);
		expect(traversal.repeatedLengthM).toBe(0);

		const positions = traversalPositions(graph, traversal);
		let passes = 0;
		for (let index = 1; index < traversal.steps.length; index++) {
			if (traversal.steps[index - 1]!.toNodeId !== crossingId) continue;
			const [before, via, after] = positions.slice(index - 1, index + 2) as Position[];
			const inX = via![0]! - before![0]!;
			const inY = via![1]! - before![1]!;
			const outX = after![0]! - via![0]!;
			const outY = after![1]! - via![1]!;
			expect(Math.abs(inX * outY - inY * outX)).toBeLessThan(1e-12);
			expect(inX * outX + inY * outY).toBeGreaterThan(0);
			passes++;
		}
		expect(passes).toBeGreaterThanOrEqual(1);
	});

	it('plans every disconnected component separately', () => {
		const graph = graphFor([
			closed(at(0, 0), at(1, 0), at(1, 1)),
			open(at(10, 0), at(12, 0)),
			open(at(11, -1), at(11, 1))
		]);
		const components = connectedComponents(graph);
		const traversals = planTopologyTraversals(graph);
		expect(traversals).toHaveLength(2);
		for (const [index, traversal] of traversals.entries()) {
			expectValidTraversal(graph, traversal, components[index]!.edgeIds);
		}
		expect(traversals[0]!.repeatedLengthM).toBe(0);
		expect(traversals[1]!.repeatedLengthM).toBeGreaterThan(0);
	});

	it('stays valid when odd nodes are paired heuristically', () => {
		const graph = graphFor([
			open(at(-3, 0), at(3, 0)),
			open(at(0, -2), at(0, 2)),
			open(at(-2, -2), at(2, 2)),
			open(at(1, 0), at(1, -1))
		]);
		const exact = plan(graph);
		const heuristic = plan(graph, { exactMatchingLimit: 0 });
		expect(exact.exact).toBe(true);
		expect(heuristic.exact).toBe(false);
		expect(heuristic.repeatedLengthM).toBeGreaterThanOrEqual(exact.repeatedLengthM - 1e-6);
	});
});
