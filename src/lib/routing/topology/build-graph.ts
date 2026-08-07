import type { Position } from 'geojson';
import type { GuidePath } from '../preparation/types';

const NUMERIC_EPSILON = 1e-12;
const COORDINATE_PRECISION = 12;

export type TopologyNode = {
	id: number;
	position: Position;
};

export type TopologyEdge = {
	id: number;
	fromNodeId: number;
	toNodeId: number;
	guideIndex: number;
	segmentIndex: number;
};

export type TopologyGraph = {
	nodes: TopologyNode[];
	edges: TopologyEdge[];
};

export type TopologySegmentRef = {
	guideIndex: number;
	segmentIndex: number;
};

export type TopologyBuildResult =
	| { ok: true; graph: TopologyGraph }
	| {
			ok: false;
			code: 'collinear-overlap';
			segments: [TopologySegmentRef, TopologySegmentRef];
	  };

type SplitPoint = {
	t: number;
	position: Position;
};

type SourceSegment = TopologySegmentRef & {
	start: Position;
	end: Position;
	splits: SplitPoint[];
};

type SegmentIntersection =
	{ kind: 'none' } | { kind: 'point'; left: SplitPoint; right: SplitPoint } | { kind: 'overlap' };

function copyPosition(position: Position): Position {
	return [position[0]!, position[1]!];
}

function normalizedCoordinate(value: number): number {
	const normalized = Number(value.toFixed(COORDINATE_PRECISION));
	return Object.is(normalized, -0) ? 0 : normalized;
}

function positionKey(position: Position): string {
	return `${normalizedCoordinate(position[0]!)},${normalizedCoordinate(position[1]!)}`;
}

function samePosition(left: Position, right: Position): boolean {
	return positionKey(left) === positionKey(right);
}

function cross(left: Position, right: Position): number {
	return left[0]! * right[1]! - left[1]! * right[0]!;
}

function dot(left: Position, right: Position): number {
	return left[0]! * right[0]! + left[1]! * right[1]!;
}

function subtract(left: Position, right: Position): Position {
	return [left[0]! - right[0]!, left[1]! - right[1]!];
}

function scaledEpsilon(left: Position, right: Position): number {
	return (
		NUMERIC_EPSILON *
		Math.max(Math.hypot(left[0]!, left[1]!) * Math.hypot(right[0]!, right[1]!), Number.EPSILON)
	);
}

function clampParameter(value: number): number {
	if (Math.abs(value) <= NUMERIC_EPSILON) return 0;
	if (Math.abs(1 - value) <= NUMERIC_EPSILON) return 1;
	return value;
}

function parameterOnSegment(position: Position, segment: SourceSegment): number {
	const direction = subtract(segment.end, segment.start);
	return dot(subtract(position, segment.start), direction) / dot(direction, direction);
}

function boxesOverlap(left: SourceSegment, right: SourceSegment): boolean {
	const leftMinX = Math.min(left.start[0]!, left.end[0]!);
	const leftMaxX = Math.max(left.start[0]!, left.end[0]!);
	const leftMinY = Math.min(left.start[1]!, left.end[1]!);
	const leftMaxY = Math.max(left.start[1]!, left.end[1]!);
	const rightMinX = Math.min(right.start[0]!, right.end[0]!);
	const rightMaxX = Math.max(right.start[0]!, right.end[0]!);
	const rightMinY = Math.min(right.start[1]!, right.end[1]!);
	const rightMaxY = Math.max(right.start[1]!, right.end[1]!);

	return !(
		leftMaxX < rightMinX - NUMERIC_EPSILON ||
		rightMaxX < leftMinX - NUMERIC_EPSILON ||
		leftMaxY < rightMinY - NUMERIC_EPSILON ||
		rightMaxY < leftMinY - NUMERIC_EPSILON
	);
}

function endpointPosition(
	left: SourceSegment,
	right: SourceSegment,
	leftT: number,
	rightT: number
): Position | null {
	if (leftT === 0) return copyPosition(left.start);
	if (leftT === 1) return copyPosition(left.end);
	if (rightT === 0) return copyPosition(right.start);
	if (rightT === 1) return copyPosition(right.end);
	return null;
}

function pointIntersection(
	left: SourceSegment,
	right: SourceSegment,
	leftT: number,
	rightT: number
): SegmentIntersection {
	const clampedLeftT = clampParameter(leftT);
	const clampedRightT = clampParameter(rightT);
	const direction = subtract(left.end, left.start);
	const position =
		endpointPosition(left, right, clampedLeftT, clampedRightT) ??
		([
			left.start[0]! + direction[0]! * clampedLeftT,
			left.start[1]! + direction[1]! * clampedLeftT
		] as Position);

	return {
		kind: 'point',
		left: { t: clampedLeftT, position },
		right: { t: clampedRightT, position }
	};
}

function intersectSegments(left: SourceSegment, right: SourceSegment): SegmentIntersection {
	if (!boxesOverlap(left, right)) return { kind: 'none' };

	const leftDirection = subtract(left.end, left.start);
	const rightDirection = subtract(right.end, right.start);
	const startDifference = subtract(right.start, left.start);
	const directionCross = cross(leftDirection, rightDirection);
	const directionTolerance = scaledEpsilon(leftDirection, rightDirection);

	if (Math.abs(directionCross) > directionTolerance) {
		const leftT = cross(startDifference, rightDirection) / directionCross;
		const rightT = cross(startDifference, leftDirection) / directionCross;
		if (
			leftT < -NUMERIC_EPSILON ||
			leftT > 1 + NUMERIC_EPSILON ||
			rightT < -NUMERIC_EPSILON ||
			rightT > 1 + NUMERIC_EPSILON
		) {
			return { kind: 'none' };
		}
		return pointIntersection(left, right, leftT, rightT);
	}

	if (
		Math.abs(cross(startDifference, leftDirection)) > scaledEpsilon(startDifference, leftDirection)
	) {
		return { kind: 'none' };
	}

	const leftLengthSquared = dot(leftDirection, leftDirection);
	const rightStartT = dot(startDifference, leftDirection) / leftLengthSquared;
	const rightEndT = dot(subtract(right.end, left.start), leftDirection) / leftLengthSquared;
	const overlapStart = Math.max(0, Math.min(rightStartT, rightEndT));
	const overlapEnd = Math.min(1, Math.max(rightStartT, rightEndT));

	if (overlapEnd < overlapStart - NUMERIC_EPSILON) return { kind: 'none' };
	if (overlapEnd - overlapStart > NUMERIC_EPSILON) return { kind: 'overlap' };

	const leftT = clampParameter((overlapStart + overlapEnd) / 2);
	const position: Position = [
		left.start[0]! + leftDirection[0]! * leftT,
		left.start[1]! + leftDirection[1]! * leftT
	];
	const rightT = clampParameter(parameterOnSegment(position, right));
	return pointIntersection(left, right, leftT, rightT);
}

function addSplit(segment: SourceSegment, split: SplitPoint) {
	const existing = segment.splits.find(
		(candidate) =>
			Math.abs(candidate.t - split.t) <= NUMERIC_EPSILON ||
			samePosition(candidate.position, split.position)
	);
	if (!existing) segment.splits.push({ t: split.t, position: copyPosition(split.position) });
}

function guidePoints(guide: GuidePath): Position[] {
	const points: Position[] = [];
	for (const point of guide.points) {
		if (!points.length || !samePosition(points[points.length - 1]!, point)) {
			points.push(copyPosition(point));
		}
	}
	if (guide.closed && points.length > 1 && samePosition(points[0]!, points[points.length - 1]!)) {
		points.pop();
	}
	return points;
}

function sourceSegments(guides: GuidePath[]): SourceSegment[] {
	const segments: SourceSegment[] = [];
	for (const [guideIndex, guide] of guides.entries()) {
		const points = guidePoints(guide);
		const minimumPoints = guide.closed ? 3 : 2;
		if (points.length < minimumPoints) continue;
		const segmentCount = guide.closed ? points.length : points.length - 1;
		for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
			const start = points[segmentIndex]!;
			const end = points[(segmentIndex + 1) % points.length]!;
			if (samePosition(start, end)) continue;
			segments.push({
				guideIndex,
				segmentIndex,
				start,
				end,
				splits: [
					{ t: 0, position: copyPosition(start) },
					{ t: 1, position: copyPosition(end) }
				]
			});
		}
	}
	return segments;
}

/** Build an undirected graph by splitting guide segments at exact point intersections. */
export function buildTopologyGraph(guides: GuidePath[]): TopologyBuildResult {
	const segments = sourceSegments(guides);

	for (let leftIndex = 0; leftIndex < segments.length; leftIndex++) {
		const left = segments[leftIndex]!;
		for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex++) {
			const right = segments[rightIndex]!;
			const intersection = intersectSegments(left, right);
			if (intersection.kind === 'none') continue;
			if (intersection.kind === 'overlap') {
				return {
					ok: false,
					code: 'collinear-overlap',
					segments: [
						{ guideIndex: left.guideIndex, segmentIndex: left.segmentIndex },
						{ guideIndex: right.guideIndex, segmentIndex: right.segmentIndex }
					]
				};
			}
			addSplit(left, intersection.left);
			addSplit(right, intersection.right);
		}
	}

	const nodes: TopologyNode[] = [];
	const nodeIds = new Map<string, number>();
	const nodeId = (position: Position) => {
		const key = positionKey(position);
		const existing = nodeIds.get(key);
		if (existing != null) return existing;
		const id = nodes.length;
		nodes.push({ id, position: copyPosition(position) });
		nodeIds.set(key, id);
		return id;
	};

	const edges: TopologyEdge[] = [];
	for (const segment of segments) {
		segment.splits.sort((left, right) => left.t - right.t);
		for (let index = 1; index < segment.splits.length; index++) {
			const fromNodeId = nodeId(segment.splits[index - 1]!.position);
			const toNodeId = nodeId(segment.splits[index]!.position);
			if (fromNodeId === toNodeId) continue;
			edges.push({
				id: edges.length,
				fromNodeId,
				toNodeId,
				guideIndex: segment.guideIndex,
				segmentIndex: segment.segmentIndex
			});
		}
	}

	return { ok: true, graph: { nodes, edges } };
}
