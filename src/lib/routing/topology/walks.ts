import { TOPOLOGY_JUNCTION_TURN_DEG } from '../config';
import type { GuideWalk } from '../preparation/types';
import type { TopologyGraph } from './build-graph';
import {
	planTopologyTraversals,
	turnAngle,
	type TopologyTraversal,
	type TraversalOptions
} from './postman';

const MIN_JUNCTION_TURN_RAD = (TOPOLOGY_JUNCTION_TURN_DEG * Math.PI) / 180;

/** Whether the walk must keep a via where it passes `nodeId` between `previous` and `next`. */
type TurnTest = (previous: number, nodeId: number, next: number) => boolean;

function walkNodeIds(traversal: TopologyTraversal): number[] {
	return [traversal.startNodeId, ...traversal.steps.map((step) => step.toNodeId)];
}

/**
 * Start a closed walk where it turns at a junction (else at any junction), so the loop's start
 * coincides with a via the walk needs anyway.
 */
function rotateToBranch(
	nodeIds: number[],
	turnsAt: TurnTest,
	branches: (nodeId: number) => boolean
): number[] {
	const ring = nodeIds.slice(0, -1);
	const at = (index: number) => ring[(index + ring.length) % ring.length]!;
	let anchor = ring.findIndex((nodeId, index) => turnsAt(at(index - 1), nodeId, at(index + 1)));
	if (anchor < 0) anchor = ring.findIndex(branches);
	if (anchor <= 0) return nodeIds;
	const rotated = [...ring.slice(anchor), ...ring.slice(0, anchor)];
	return [...rotated, rotated[0]!];
}

/**
 * Plan one Chinese Postman walk per connected component, in `connectedComponents` order. Walk ends
 * and every pass that turns at a junction are mandatory; a dead-end tip turns back, so it always
 * counts. Dropping a turn would let the matched route cut a corner or skip a retraced branch, but
 * riding straight through a crossing needs no via, so many crossings do not exhaust the via cap.
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
	const position = (nodeId: number) => graph.nodes[nodeId]!.position;
	const turnsAt: TurnTest = (previous, nodeId, next) =>
		branches(nodeId) &&
		turnAngle(position(previous), position(nodeId), position(next)) > MIN_JUNCTION_TURN_RAD;

	return planTopologyTraversals(graph, options).map((traversal) => {
		const closed = traversal.startNodeId === traversal.endNodeId;
		const nodeIds = closed
			? rotateToBranch(walkNodeIds(traversal), turnsAt, branches)
			: walkNodeIds(traversal);
		const last = nodeIds.length - 1;
		const mandatory = [0];
		for (let index = 1; index < last; index++) {
			if (turnsAt(nodeIds[index - 1]!, nodeIds[index]!, nodeIds[index + 1]!)) {
				mandatory.push(index);
			}
		}
		if (last > 0) mandatory.push(last);
		return {
			points: nodeIds.map(position),
			mandatory,
			closed
		};
	});
}
