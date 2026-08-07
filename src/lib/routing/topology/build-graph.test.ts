import { describe, expect, it } from 'vitest';
import type { Position } from 'geojson';
import type { GuidePath } from '../preparation/types';
import { buildTopologyGraph, type TopologyGraph } from './build-graph';

function open(...points: Position[]): GuidePath {
	return { points, closed: false };
}

function closed(...points: Position[]): GuidePath {
	return { points, closed: true };
}

function graphFor(guides: GuidePath[]): TopologyGraph {
	const result = buildTopologyGraph(guides);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.code);
	return result.graph;
}

function nodeAt(graph: TopologyGraph, position: Position) {
	return graph.nodes.find(
		(node) => node.position[0] === position[0] && node.position[1] === position[1]
	);
}

function degree(graph: TopologyGraph, nodeId: number): number {
	return graph.edges.reduce(
		(total, edge) => total + Number(edge.fromNodeId === nodeId) + Number(edge.toNodeId === nodeId),
		0
	);
}

describe('buildTopologyGraph', () => {
	it('turns open and closed guide segments into graph edges', () => {
		const openGraph = graphFor([open([0, 0], [1, 1], [2, 0])]);
		expect(openGraph.nodes).toHaveLength(3);
		expect(openGraph.edges).toHaveLength(2);

		const closedGraph = graphFor([closed([0, 0], [1, 0], [1, 1], [0, 1])]);
		expect(closedGraph.nodes).toHaveLength(4);
		expect(closedGraph.edges).toHaveLength(4);
		expect(closedGraph.nodes.every((node) => degree(closedGraph, node.id) === 2)).toBe(true);
	});

	it('shares a node between guides that touch at an endpoint', () => {
		const graph = graphFor([open([0, 0], [1, 0]), open([1, 0], [2, 0])]);
		const junction = nodeAt(graph, [1, 0]);
		expect(graph.nodes).toHaveLength(3);
		expect(graph.edges).toHaveLength(2);
		expect(junction && degree(graph, junction.id)).toBe(2);
	});

	it('splits a host segment at a T-junction', () => {
		const graph = graphFor([open([0, 0], [2, 0]), open([1, 0], [1, 1])]);
		const junction = nodeAt(graph, [1, 0]);
		expect(graph.nodes).toHaveLength(4);
		expect(graph.edges).toHaveLength(3);
		expect(junction && degree(graph, junction.id)).toBe(3);
	});

	it('splits both segments at a mid-segment crossing', () => {
		const graph = graphFor([open([0, 0], [2, 0]), open([1, -1], [1, 1])]);
		const junction = nodeAt(graph, [1, 0]);
		expect(graph.nodes).toHaveLength(5);
		expect(graph.edges).toHaveLength(4);
		expect(junction && degree(graph, junction.id)).toBe(4);
	});

	it('nodes a self-crossing guide', () => {
		const graph = graphFor([open([0, 0], [2, 2], [0, 2], [2, 0])]);
		const junction = nodeAt(graph, [1, 1]);
		expect(graph.nodes).toHaveLength(5);
		expect(graph.edges).toHaveLength(5);
		expect(junction && degree(graph, junction.id)).toBe(4);
	});

	it('detects an intersection on a closed guide closing segment', () => {
		const graph = graphFor([closed([0, 0], [2, 0], [2, 2]), open([0.5, 1], [1.5, 1])]);
		const junction = nodeAt(graph, [1, 1]);
		expect(junction && degree(graph, junction.id)).toBe(4);
	});

	it('does not connect a near miss', () => {
		const graph = graphFor([open([0, 0], [2, 0]), open([1, 0.000001], [1, 1])]);
		expect(graph.nodes).toHaveLength(4);
		expect(graph.edges).toHaveLength(2);
	});

	it('supports a single-point collinear touch', () => {
		const graph = graphFor([open([0, 0], [1, 0]), open([1, 0], [2, 0])]);
		expect(nodeAt(graph, [1, 0])).toBeDefined();
		expect(graph.nodes).toHaveLength(3);
	});

	it('reports a positive-length collinear overlap', () => {
		const result = buildTopologyGraph([open([0, 0], [2, 0]), open([1, 0], [3, 0])]);
		expect(result).toEqual({
			ok: false,
			code: 'collinear-overlap',
			segments: [
				{ guideIndex: 0, segmentIndex: 0 },
				{ guideIndex: 1, segmentIndex: 0 }
			]
		});
	});

	it('drops duplicate consecutive coordinates and produces stable output', () => {
		const guides = [open([0, 0], [0, 0], [1, 0])];
		const first = buildTopologyGraph(guides);
		const second = buildTopologyGraph(guides);
		expect(first).toEqual(second);
		expect(first).toMatchObject({
			ok: true,
			graph: { nodes: [{ id: 0 }, { id: 1 }], edges: [{ id: 0 }] }
		});
	});
});
