import type { GuideWalk } from '../preparation/types';
import type { TopologyGraph } from './build-graph';
import { planTopologyTraversals, type TopologyTraversal, type TraversalOptions } from './postman';

function walkNodeIds(traversal: TopologyTraversal): number[] {
	return [traversal.startNodeId, ...traversal.steps.map((step) => step.toNodeId)];
}

/** Start a closed walk at its first branching node, so the loop's start needs no extra via. */
function rotateToBranch(nodeIds: number[], branches: (nodeId: number) => boolean): number[] {
	const ring = nodeIds.slice(0, -1);
	const anchor = ring.findIndex(branches);
	if (anchor <= 0) return nodeIds;
	const rotated = [...ring.slice(anchor), ...ring.slice(0, anchor)];
	return [...rotated, rotated[0]!];
}

/**
 * Plan one Chinese Postman walk per connected component, in `connectedComponents` order. Every
 * pass through a junction and every dead-end tip is mandatory: dropping either would let the
 * matched route cut a corner or skip a retraced branch.
 */
export function planTopologyWalks(
	graph: TopologyGraph,
	options: TraversalOptions = {}
): GuideWalk[] {
	const degree = new Uint32Array(graph.nodes.length);
	for (const edge of graph.edges) {
		degree[edge.fromNodeId]! += 1;
		degree[edge.toNodeId]! += 1;
	}
	const branches = (nodeId: number) => degree[nodeId] !== 2;

	return planTopologyTraversals(graph, options).map((traversal) => {
		const closed = traversal.startNodeId === traversal.endNodeId;
		const nodeIds = closed
			? rotateToBranch(walkNodeIds(traversal), branches)
			: walkNodeIds(traversal);
		const last = nodeIds.length - 1;
		const mandatory: number[] = [];
		for (const [index, nodeId] of nodeIds.entries()) {
			if (index === 0 || index === last || branches(nodeId)) mandatory.push(index);
		}
		return {
			points: nodeIds.map((nodeId) => graph.nodes[nodeId]!.position),
			mandatory,
			closed
		};
	});
}
