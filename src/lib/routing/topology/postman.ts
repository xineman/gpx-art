import type { Position } from 'geojson';
import { distanceBetween } from '#lib/geometry/distance.js';
import type { TopologyGraph } from './build-graph';
import { matchAllButTwo } from './matching';

const TURN_EPSILON = 1e-9;

export type TopologyComponent = {
	nodeIds: number[];
	edgeIds: number[];
};

export type TraversalStep = {
	edgeId: number;
	fromNodeId: number;
	toNodeId: number;
	/** True when an earlier step already covered this edge. */
	repeated: boolean;
};

/**
 * A walk over one connected component. It ends at its start node only when the component has no
 * odd-degree nodes; otherwise it finishes at the other end that saves the most retracing.
 */
export type TopologyTraversal = {
	startNodeId: number;
	endNodeId: number;
	steps: TraversalStep[];
	/** Length of every drawn edge, each counted once. */
	drawnLengthM: number;
	/** Extra distance spent retracing duplicated edges. */
	repeatedLengthM: number;
	/** False when odd-degree nodes were paired heuristically. */
	exact: boolean;
};

export type TraversalOptions = {
	exactMatchingLimit?: number;
};

type Neighbor = {
	edgeId: number;
	nodeId: number;
};

/** Graph lookups shared by every component. Node and edge ids index their arrays. */
type GraphContext = {
	graph: TopologyGraph;
	adjacency: Neighbor[][];
	lengths: Float64Array;
};

type ShortestPaths = {
	distance: Float64Array;
	previousEdge: Int32Array;
};

type WalkFrame = {
	nodeId: number;
	fromNodeId: number;
	arc: number;
};

function contextFor(graph: TopologyGraph): GraphContext {
	const adjacency: Neighbor[][] = graph.nodes.map(() => []);
	const lengths = new Float64Array(graph.edges.length);
	for (const edge of graph.edges) {
		adjacency[edge.fromNodeId]!.push({ edgeId: edge.id, nodeId: edge.toNodeId });
		adjacency[edge.toNodeId]!.push({ edgeId: edge.id, nodeId: edge.fromNodeId });
		lengths[edge.id] = distanceBetween(
			graph.nodes[edge.fromNodeId]!.position,
			graph.nodes[edge.toNodeId]!.position
		);
	}
	return { graph, adjacency, lengths };
}

function componentsOf({ graph, adjacency }: GraphContext): TopologyComponent[] {
	const visited = new Uint8Array(graph.nodes.length);
	const components: TopologyComponent[] = [];

	for (const { id: rootId } of graph.nodes) {
		if (visited[rootId] || adjacency[rootId]!.length === 0) continue;
		visited[rootId] = 1;
		const nodeIds: number[] = [];
		const edgeIds = new Set<number>();
		const queue = [rootId];
		for (let index = 0; index < queue.length; index++) {
			const nodeId = queue[index]!;
			nodeIds.push(nodeId);
			for (const neighbor of adjacency[nodeId]!) {
				edgeIds.add(neighbor.edgeId);
				if (visited[neighbor.nodeId]) continue;
				visited[neighbor.nodeId] = 1;
				queue.push(neighbor.nodeId);
			}
		}
		components.push({
			nodeIds: nodeIds.sort((a, b) => a - b),
			edgeIds: [...edgeIds].sort((a, b) => a - b)
		});
	}
	return components;
}

/** Split a topology graph into its connected components, ordered by lowest node id. */
export function connectedComponents(graph: TopologyGraph): TopologyComponent[] {
	return componentsOf(contextFor(graph));
}

/** Binary heap of `[distance, nodeId]` entries; stale entries are skipped by the caller. */
class DistanceHeap {
	#entries: [number, number][] = [];

	get size() {
		return this.#entries.length;
	}

	push(entry: [number, number]) {
		const entries = this.#entries;
		entries.push(entry);
		let index = entries.length - 1;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (entries[parent]![0] <= entry[0]) break;
			entries[index] = entries[parent]!;
			index = parent;
		}
		entries[index] = entry;
	}

	pop(): [number, number] | undefined {
		const entries = this.#entries;
		const top = entries[0];
		const last = entries.pop();
		if (!top || !last || entries.length === 0) return top;

		let index = 0;
		for (;;) {
			const left = index * 2 + 1;
			const right = left + 1;
			let smallest = index;
			let smallestDistance = last[0];
			if (left < entries.length && entries[left]![0] < smallestDistance) {
				smallest = left;
				smallestDistance = entries[left]![0];
			}
			if (right < entries.length && entries[right]![0] < smallestDistance) smallest = right;
			if (smallest === index) break;
			entries[index] = entries[smallest]!;
			index = smallest;
		}
		entries[index] = last;
		return top;
	}
}

function shortestPaths({ graph, adjacency, lengths }: GraphContext, source: number): ShortestPaths {
	const distance = new Float64Array(graph.nodes.length).fill(Number.POSITIVE_INFINITY);
	const previousEdge = new Int32Array(graph.nodes.length).fill(-1);
	const heap = new DistanceHeap();
	distance[source] = 0;
	heap.push([0, source]);

	while (heap.size) {
		const [nodeDistance, nodeId] = heap.pop()!;
		if (nodeDistance > distance[nodeId]!) continue;
		for (const neighbor of adjacency[nodeId]!) {
			const candidate = nodeDistance + lengths[neighbor.edgeId]!;
			if (candidate < distance[neighbor.nodeId]!) {
				distance[neighbor.nodeId] = candidate;
				previousEdge[neighbor.nodeId] = neighbor.edgeId;
				heap.push([candidate, neighbor.nodeId]);
			}
		}
	}
	return { distance, previousEdge };
}

function otherEnd(graph: TopologyGraph, edgeId: number, nodeId: number): number {
	const edge = graph.edges[edgeId]!;
	return edge.fromNodeId === nodeId ? edge.toNodeId : edge.fromNodeId;
}

function pathEdges(graph: TopologyGraph, paths: ShortestPaths, target: number): number[] {
	const edgeIds: number[] = [];
	for (let nodeId = target; paths.previousEdge[nodeId]! >= 0;) {
		const edgeId = paths.previousEdge[nodeId]!;
		edgeIds.push(edgeId);
		nodeId = otherEnd(graph, edgeId, nodeId);
	}
	return edgeIds;
}

/** Angle between the incoming and outgoing directions at `via`, in radians; 0 continues straight. */
export function turnAngle(from: Position, via: Position, to: Position): number {
	const longitudeScale = Math.cos((via[1]! * Math.PI) / 180);
	const inX = (via[0]! - from[0]!) * longitudeScale;
	const inY = via[1]! - from[1]!;
	const outX = (to[0]! - via[0]!) * longitudeScale;
	const outY = to[1]! - via[1]!;
	return Math.atan2(Math.abs(inX * outY - inY * outX), inX * outX + inY * outY);
}

/**
 * Hierholzer's algorithm over edge instances (`arcs`, one entry per traversal). Each extension
 * prefers the straightest unused continuation, so crossings are ridden through, not turned at.
 */
function eulerWalk(graph: TopologyGraph, arcs: number[], startNodeId: number): TraversalStep[] {
	const incident: number[][] = graph.nodes.map(() => []);
	for (const [arc, edgeId] of arcs.entries()) {
		const edge = graph.edges[edgeId]!;
		incident[edge.fromNodeId]!.push(arc);
		incident[edge.toNodeId]!.push(arc);
	}
	const used = new Uint8Array(arcs.length);
	const position = (nodeId: number) => graph.nodes[nodeId]!.position;

	const nextArc = ({ nodeId, fromNodeId }: WalkFrame): number => {
		let best = -1;
		let bestTurn = Number.POSITIVE_INFINITY;
		for (const arc of incident[nodeId]!) {
			if (used[arc]) continue;
			if (fromNodeId < 0) return arc;
			const turn = turnAngle(
				position(fromNodeId),
				position(nodeId),
				position(otherEnd(graph, arcs[arc]!, nodeId))
			);
			if (turn < bestTurn - TURN_EPSILON) {
				best = arc;
				bestTurn = turn;
			}
		}
		return best;
	};

	const stack: WalkFrame[] = [{ nodeId: startNodeId, fromNodeId: -1, arc: -1 }];
	const finished: WalkFrame[] = [];
	while (stack.length) {
		const top = stack[stack.length - 1]!;
		const arc = nextArc(top);
		if (arc < 0) {
			finished.push(stack.pop()!);
			continue;
		}
		used[arc] = 1;
		stack.push({ nodeId: otherEnd(graph, arcs[arc]!, top.nodeId), fromNodeId: top.nodeId, arc });
	}

	// Finished frames come out in reverse walk order; each frame's arc enters its node.
	const seen = new Set<number>();
	const steps: TraversalStep[] = [];
	for (let index = finished.length - 2; index >= 0; index--) {
		const { nodeId, fromNodeId, arc } = finished[index]!;
		const edgeId = arcs[arc]!;
		steps.push({ edgeId, fromNodeId, toNodeId: nodeId, repeated: seen.has(edgeId) });
		seen.add(edgeId);
	}
	return steps;
}

function planWithContext(
	context: GraphContext,
	component: TopologyComponent,
	options: TraversalOptions
): TopologyTraversal {
	const { graph, lengths } = context;
	const degree = new Map<number, number>();
	for (const edgeId of component.edgeIds) {
		const edge = graph.edges[edgeId]!;
		degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1);
		degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1);
	}
	const oddNodeIds = component.nodeIds.filter((nodeId) => (degree.get(nodeId) ?? 0) % 2 === 1);
	// The route's two ends absorb two odd nodes; every other odd node needs a retraced path.
	const paths =
		oddNodeIds.length > 2 ? oddNodeIds.map((nodeId) => shortestPaths(context, nodeId)) : [];
	const matching = matchAllButTwo(
		oddNodeIds.length,
		(left, right) => paths[left]!.distance[oddNodeIds[right]!]!,
		{ exactLimit: options.exactMatchingLimit }
	);
	// Every finite graph has an even number of odd-degree nodes.
	if (!matching) throw new Error('Topology component has an odd number of odd-degree nodes.');

	// Two paired paths may share an edge; duplicating it twice keeps parity but wastes distance.
	const duplicated = new Uint8Array(graph.edges.length);
	for (const [left, right] of matching.pairs) {
		for (const edgeId of pathEdges(graph, paths[left]!, oddNodeIds[right]!)) {
			duplicated[edgeId]! ^= 1;
		}
	}
	const duplicatedEdgeIds = component.edgeIds.filter((edgeId) => duplicated[edgeId]);

	const startNodeId =
		matching.unpaired.length > 0 ? oddNodeIds[matching.unpaired[0]!]! : component.nodeIds[0]!;
	const steps = eulerWalk(graph, [...component.edgeIds, ...duplicatedEdgeIds], startNodeId);
	const sumLengths = (edgeIds: number[]) =>
		edgeIds.reduce((total, edgeId) => total + lengths[edgeId]!, 0);

	return {
		startNodeId,
		endNodeId: steps.at(-1)?.toNodeId ?? startNodeId,
		steps,
		drawnLengthM: sumLengths(component.edgeIds),
		repeatedLengthM: sumLengths(duplicatedEdgeIds),
		exact: matching.exact
	};
}

/**
 * Chinese Postman traversal of one connected component: cover every edge, duplicating the
 * cheapest set of shortest paths that leaves an Euler trail (or circuit) through the component.
 */
export function planComponentTraversal(
	graph: TopologyGraph,
	component: TopologyComponent,
	options: TraversalOptions = {}
): TopologyTraversal {
	return planWithContext(contextFor(graph), component, options);
}

/** Plan one traversal per connected component, in `connectedComponents` order. */
export function planTopologyTraversals(
	graph: TopologyGraph,
	options: TraversalOptions = {}
): TopologyTraversal[] {
	const context = contextFor(graph);
	return componentsOf(context).map((component) => planWithContext(context, component, options));
}

/** Node positions visited by a traversal, starting with its start node. */
export function traversalPositions(graph: TopologyGraph, traversal: TopologyTraversal): Position[] {
	return [
		graph.nodes[traversal.startNodeId]!.position,
		...traversal.steps.map((step) => graph.nodes[step.toNodeId]!.position)
	];
}
