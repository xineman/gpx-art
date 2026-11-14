import { describe, expect, it } from 'vitest';
import type { Position } from 'geojson';
import type { GuidePath } from '../preparation/types';
import { buildTopologyGraph, type TopologyGraph } from './build-graph';
import { connectedComponents } from './postman';

function open(...points: Position[]): GuidePath {
	return { points, closed: false };
}

function closed(...points: Position[]): GuidePath {
	return { points, closed: true };
}

function nodeAt(graph: TopologyGraph, position: Position) {
	return graph.nodes.find(
		(node) => node.position[0] === position[0] && node.position[1] === position[1]
	);
}

function nodeNear(graph: TopologyGraph, position: Position) {
	return graph.nodes.find(
		(node) =>
			Math.abs(node.position[0]! - position[0]!) < 1e-9 &&
			Math.abs(node.position[1]! - position[1]!) < 1e-9
	);
}

function degree(graph: TopologyGraph, nodeId: number): number {
	return graph.edges.reduce(
		(total, edge) => total + Number(edge.fromNodeId === nodeId) + Number(edge.toNodeId === nodeId),
		0
	);
}

function nodesOfDegree(graph: TopologyGraph, count: number) {
	return graph.nodes.filter(({ id }) => degree(graph, id) === count);
}

/** Warsaw-scale position: one unit is 0.001°, roughly 68 m east or 111 m north. */
function at(x: number, y: number): Position {
	return [21 + x * 0.001, 52.2 + y * 0.001];
}

describe('buildTopologyGraph', () => {
	it('turns open and closed guide segments into graph edges', () => {
		const openGraph = buildTopologyGraph([open([0, 0], [1, 1], [2, 0])]);
		expect(openGraph.nodes).toHaveLength(3);
		expect(openGraph.edges).toHaveLength(2);

		const closedGraph = buildTopologyGraph([closed([0, 0], [1, 0], [1, 1], [0, 1])]);
		expect(closedGraph.nodes).toHaveLength(4);
		expect(closedGraph.edges).toHaveLength(4);
		expect(closedGraph.nodes.every((node) => degree(closedGraph, node.id) === 2)).toBe(true);
	});

	it('shares a node between guides that touch at an endpoint', () => {
		const graph = buildTopologyGraph([open([0, 0], [1, 0]), open([1, 0], [2, 0])]);
		const junction = nodeAt(graph, [1, 0]);
		expect(graph.nodes).toHaveLength(3);
		expect(graph.edges).toHaveLength(2);
		expect(junction && degree(graph, junction.id)).toBe(2);
	});

	it('splits a host segment at a T-junction', () => {
		const graph = buildTopologyGraph([open([0, 0], [2, 0]), open([1, 0], [1, 1])]);
		const junction = nodeAt(graph, [1, 0]);
		expect(graph.nodes).toHaveLength(4);
		expect(graph.edges).toHaveLength(3);
		expect(junction && degree(graph, junction.id)).toBe(3);
	});

	it.each([0, 10])('unifies existing crossing splits with snap tolerance %i', (snapToleranceM) => {
		const host = open([0, 0], [0.002, 0]);
		const branch = open([0.001, 0], [0.001, 0.001]);
		const touching = open([0.0010000005, -0.001], [0.0010000005, 0], [0.002, 0.001]);
		for (const guides of [
			[host, branch, touching],
			[host, touching, branch],
			[branch, host, touching],
			[branch, touching, host],
			[touching, host, branch],
			[touching, branch, host]
		]) {
			const original = structuredClone(guides);
			const graph = buildTopologyGraph(guides, { snapToleranceM });
			expect(connectedComponents(graph)).toHaveLength(1);
			expect(nodesOfDegree(graph, 5)).toHaveLength(1);
			expect(graph.edges).toHaveLength(5);
			expect(guides).toEqual(original);
		}
	});

	it('splits both segments at a mid-segment crossing', () => {
		const graph = buildTopologyGraph([open([0, 0], [2, 0]), open([1, -1], [1, 1])]);
		const junction = nodeAt(graph, [1, 0]);
		expect(graph.nodes).toHaveLength(5);
		expect(graph.edges).toHaveLength(4);
		expect(junction && degree(graph, junction.id)).toBe(4);
	});

	it('nodes a self-crossing guide', () => {
		const graph = buildTopologyGraph([open([0, 0], [2, 2], [0, 2], [2, 0])]);
		const junction = nodeAt(graph, [1, 1]);
		expect(graph.nodes).toHaveLength(5);
		expect(graph.edges).toHaveLength(5);
		expect(junction && degree(graph, junction.id)).toBe(4);
	});

	it('detects an intersection on a closed guide closing segment', () => {
		const graph = buildTopologyGraph([closed([0, 0], [2, 0], [2, 2]), open([0.5, 1], [1.5, 1])]);
		const junction = nodeAt(graph, [1, 1]);
		expect(junction && degree(graph, junction.id)).toBe(4);
	});

	it('snaps an endpoint to a host segment within the default tolerance', () => {
		const graph = buildTopologyGraph([
			open([0, 0], [0.002, 0]),
			open([0.001, 0.00005], [0.001, 0.001])
		]);
		const junction = nodeAt(graph, [0.001, 0]);
		expect(graph.edges).toHaveLength(3);
		expect(junction && degree(graph, junction.id)).toBe(3);
	});

	it('preserves an exact T-junction when a nearby stroke also needs to snap', () => {
		const spur = open([0.00012, 0], [0.00012, 0.001]);
		const host = open([0, 0], [0.002, 0]);
		const approach = open([-0.00002, -0.00007], [-0.00002, -0.001]);

		for (const guides of [
			[spur, host, approach],
			[host, spur, approach],
			[approach, host, spur]
		]) {
			const graph = buildTopologyGraph(guides);
			const junction = nodeAt(graph, [0.00012, 0]);
			expect(graph.nodes).toHaveLength(5);
			expect(graph.edges).toHaveLength(4);
			expect(junction && degree(graph, junction.id)).toBe(3);
		}
	});

	it('splits a sloped host at the accepted snap even when the projection rounds off the line', () => {
		const graph = buildTopologyGraph([
			open([21.01001237, 52.2300131], [21.01032347, 52.2301544]),
			open([21.01015237, 52.2301031], [21.01018237, 52.2310131])
		]);

		expect(graph.edges).toHaveLength(3);
		expect(graph.nodes.filter(({ id }) => degree(graph, id) === 3)).toHaveLength(1);
	});

	it.each([
		['collapse', open([0.001, 0.00002], [0.001, 0.00006])],
		['overlap', open([0.0005, 0.00003], [0.0015, 0.00003])]
	])('keeps both strokes when snapping would cause %s', (_, stroke) => {
		const guides = [open([0, 0], [0.002, 0]), stroke];
		expect(buildTopologyGraph(guides)).toEqual(buildTopologyGraph(guides, { snapToleranceM: 0 }));
	});

	it('keeps the original geometry when moving one end would overlap another edge', () => {
		const guides = [
			open([0, 0], [0.002, 0]),
			open([0.001, 0.00005], [0.003, 0]),
			open([0.002, 0], [0.003, 0])
		];
		expect(buildTopologyGraph(guides)).toEqual(buildTopologyGraph(guides, { snapToleranceM: 0 }));
	});

	it('splits additional crossings created by an accepted snap', () => {
		const graph = buildTopologyGraph([
			closed([-0.0005, 0], [0.0005, 0], [0.0005, -0.001], [-0.0005, -0.001]),
			open([0, 0.00006], [0.003, 0.00006]),
			// Lies between the line and its snapped position, so only the moved line crosses it.
			closed([0.0015, 0.00002], [0.0016, 0.00002], [0.00155, 0.00004])
		]);

		expect(graph.edges).toHaveLength(13);
		expect(nodesOfDegree(graph, 4)).toHaveLength(2);
	});

	it('trims a short overshoot past a crossing but keeps an isolated short stroke', () => {
		const graph = buildTopologyGraph([
			open(at(0, 0), at(4, 0)),
			open(at(2, -2), at(2, 0.01), at(2.01, 0.02), at(2, 0.03)),
			open(at(10, 10), at(10, 10.05))
		]);
		const crossing = nodeNear(graph, at(2, 0));

		expect(crossing && degree(graph, crossing.id)).toBe(3);
		expect(nodesOfDegree(graph, 1)).toHaveLength(5);
		expect(nodeNear(graph, at(2, 0.03))).toBeUndefined();
		expect(nodeAt(graph, at(10, 10.05))).toBeDefined();
	});

	it('trims both sides of a short stroke crossing a line', () => {
		const graph = buildTopologyGraph([open(at(0, 0), at(4, 0)), open(at(2, -0.03), at(2, 0.04))]);
		expect(graph.edges).toHaveLength(2);
		expect(nodesOfDegree(graph, 1)).toHaveLength(2);
	});

	it('honors custom, disabled, and default snapping tolerances', () => {
		const nearGuides = [open([0, 0], [0.002, 0]), open([0.001, 0.00005], [0.001, 0.001])];
		expect(buildTopologyGraph(nearGuides, { snapToleranceM: 5 }).edges).toHaveLength(2);
		expect(buildTopologyGraph(nearGuides, { snapToleranceM: 6 }).edges).toHaveLength(3);
		expect(buildTopologyGraph(nearGuides, { snapToleranceM: 0 }).edges).toHaveLength(2);

		const outsideDefault = buildTopologyGraph([
			open([0, 0], [0.002, 0]),
			open([0.001, 0.0001], [0.001, 0.001])
		]);
		expect(outsideDefault.edges).toHaveLength(2);
	});

	it('joins a near endpoint pair at its midpoint without mutating the guides', () => {
		const guides = [open([0, 0], [0.001, 0]), open([0.00105, 0], [0.002, 0])];
		const original = guides.map((guide) => guide.points.map((point) => [...point]));
		const graph = buildTopologyGraph(guides);
		const junction = nodeNear(graph, [0.001025, 0]);

		expect(graph.nodes).toHaveLength(3);
		expect(junction && degree(graph, junction.id)).toBe(2);
		expect(guides.map((guide) => guide.points)).toEqual(original);
	});

	it('snaps both endpoints of an open guide onto a closed guide', () => {
		const graph = buildTopologyGraph([
			closed([0, 0], [0.002, 0], [0.002, 0.002], [0, 0.002]),
			open([0.001, 0.00005], [0.001, 0.00195])
		]);
		const bottom = nodeAt(graph, [0.001, 0]);
		const top = nodeAt(graph, [0.001, 0.002]);

		expect(bottom && degree(graph, bottom.id)).toBe(3);
		expect(top && degree(graph, top.id)).toBe(3);
	});

	it('snaps onto a non-incident segment of the same guide', () => {
		const graph = buildTopologyGraph([open([0, 0], [0.002, 0], [0.002, 0.002], [0.001, 0.00005])]);
		const junction = nodeAt(graph, [0.001, 0]);

		expect(graph.edges).toHaveLength(4);
		expect(junction && degree(graph, junction.id)).toBe(3);
	});

	it('snaps to the nearest eligible path', () => {
		const graph = buildTopologyGraph([
			closed([0, -0.001], [0.002, -0.001], [0.002, 0], [0, 0]),
			closed([0, 0.00008], [0.002, 0.00008], [0.002, 0.001], [0, 0.001]),
			open([0.001, 0.00003], [0.003, 0.00004], [0.004, 0.00004])
		]);
		const nearest = nodeAt(graph, [0.001, 0]);

		expect(nearest && degree(graph, nearest.id)).toBe(3);
		expect(nodeAt(graph, [0.001, 0.00008])).toBeUndefined();
	});

	it.each([1, 5, 20, 100])(
		'snaps the end of a stroke sampled into %i segments onto a host',
		(segmentCount) => {
			const stroke = Array.from({ length: segmentCount + 1 }, (_, index) =>
				at(0, 1 - (0.95 * index) / segmentCount)
			);
			const graph = buildTopologyGraph([open(at(-1, 0), at(1, 0)), open(...stroke)]);
			const junction = nodeNear(graph, at(0, 0));

			expect(junction && degree(graph, junction.id)).toBe(3);
			expect(nodesOfDegree(graph, 1)).toHaveLength(3);
		}
	);

	it('joins the near-miss apex and crossbar of a letter A', () => {
		const left = open(at(-2, 0), at(-0.05, 4));
		const right = open(at(2, 0), at(0, 4.02));
		const bar = open(at(-0.95, 2), at(0.95, 2));

		for (const guides of [
			[left, right],
			[left, right, bar],
			[bar, right, left]
		]) {
			const graph = buildTopologyGraph(guides);
			const freeEnds = nodesOfDegree(graph, 1).map(({ position }) => position);
			expect(freeEnds).toHaveLength(2);
			expect(freeEnds).toEqual(expect.arrayContaining([at(-2, 0), at(2, 0)]));
			expect(nodesOfDegree(graph, 3)).toHaveLength(guides.length === 3 ? 2 : 0);
		}
	});

	it('makes every link of a near-miss chain in any guide order', () => {
		const first = open(at(-1, 1), at(-0.05, 1));
		const second = open(at(0, 2), at(0, 0.05));
		const third = open(at(-1, 0), at(1, 0));

		for (const guides of [
			[first, second, third],
			[first, third, second],
			[second, first, third],
			[second, third, first],
			[third, first, second],
			[third, second, first]
		]) {
			const graph = buildTopologyGraph(guides);
			expect(nodesOfDegree(graph, 3)).toHaveLength(2);
			expect(nodesOfDegree(graph, 1)).toHaveLength(4);
			expect(nodeNear(graph, at(0, 0))).toBeDefined();
			expect(nodeNear(graph, at(0, 1))).toBeDefined();
		}
	});

	it('supports a single-point collinear touch', () => {
		const graph = buildTopologyGraph([open([0, 0], [1, 0]), open([1, 0], [2, 0])]);
		expect(nodeAt(graph, [1, 0])).toBeDefined();
		expect(graph.nodes).toHaveLength(3);
	});

	it('joins three lines through one interior point at a single node', () => {
		// Mulberry32: a seeded generator keeps the random trials reproducible.
		let seed = 0x5eed;
		const random = () => {
			seed = (seed + 0x6d2b79f5) | 0;
			let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
			return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32;
		};
		const [centerX, centerY] = at(0, 0) as [number, number];
		const ray = (angle: number, length: number): Position => [
			centerX + Math.cos(angle) * length * 0.001,
			centerY + Math.sin(angle) * length * 0.001
		];

		let splitCenters = 0;
		for (let trial = 0; trial < 2000; trial++) {
			const guides = Array.from({ length: 3 }, () => {
				const angle = random() * Math.PI;
				return open(ray(angle, -0.5 - random()), ray(angle, 0.5 + random()));
			});
			if (buildTopologyGraph(guides, { snapToleranceM: 0 }).nodes.length !== 7) splitCenters++;
		}
		expect(splitCenters).toBe(0);
	});

	it('merges a partial collinear overlap into one shared edge', () => {
		const graph = buildTopologyGraph([open([0, 0], [2, 0]), open([1, 0], [3, 0])]);
		const shared = graph.edges.find(({ sources }) => sources.length === 2);

		expect(graph.nodes).toHaveLength(4);
		expect(graph.edges).toHaveLength(3);
		expect(shared?.sources).toEqual([
			{ guideIndex: 0, segmentIndex: 0 },
			{ guideIndex: 1, segmentIndex: 0 }
		]);
	});

	it('keeps one edge where two squares share a side', () => {
		const graph = buildTopologyGraph([
			closed(at(0, 0), at(1, 0), at(1, 1), at(0, 1)),
			closed(at(1, 0), at(2, 0), at(2, 1), at(1, 1))
		]);

		expect(graph.nodes).toHaveLength(6);
		expect(graph.edges).toHaveLength(7);
		expect(nodesOfDegree(graph, 3)).toHaveLength(2);
		expect(graph.edges.filter(({ sources }) => sources.length === 2)).toHaveLength(1);
	});

	it('collapses an out-and-back stroke into a dead-end branch', () => {
		const graph = buildTopologyGraph([
			open(at(0, 0), at(2, 0)),
			open(at(1, 0), at(1, 1), at(1, 2), at(1, 1))
		]);
		const branchTip = nodeAt(graph, at(1, 2));

		expect(graph.edges).toHaveLength(4);
		expect(branchTip && degree(graph, branchTip.id)).toBe(1);
		expect(nodesOfDegree(graph, 1)).toHaveLength(3);
	});

	it('drops duplicate consecutive coordinates and produces stable output', () => {
		const guides = [open([0, 0], [0, 0], [1, 0])];
		const first = buildTopologyGraph(guides);
		expect(first).toEqual(buildTopologyGraph(guides));
		expect(first).toMatchObject({ nodes: [{ id: 0 }, { id: 1 }], edges: [{ id: 0 }] });
	});
});
