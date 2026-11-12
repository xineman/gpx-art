import type { Position } from 'geojson';
import { TOPOLOGY_SNAP_TOLERANCE_M } from '#lib/config/routing.js';
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

export type TopologyBuildOptions = {
	snapToleranceM?: number;
};

type SplitPoint = {
	t: number;
	position: Position;
};

type Segment = TopologySegmentRef & {
	start: Position;
	end: Position;
};

type SourceSegment = Segment & {
	splits: SplitPoint[];
};

type SegmentIntersection =
	{ kind: 'none' } | { kind: 'point'; left: SplitPoint; right: SplitPoint } | { kind: 'overlap' };

type SegmentProjection = SplitPoint & {
	distanceM: number;
};

type Snap = {
	target: SourceSegment;
	split: SplitPoint;
};

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

function projectPointToSegment(point: Position, segment: Segment): SegmentProjection {
	const midLatitude = (((segment.start[1]! + segment.end[1]!) / 2) * Math.PI) / 180;
	const metersPerLongitude = 111_320 * Math.cos(midLatitude);
	const metersPerLatitude = 110_540;
	const segmentX = (segment.end[0]! - segment.start[0]!) * metersPerLongitude;
	const segmentY = (segment.end[1]! - segment.start[1]!) * metersPerLatitude;
	const pointX = (point[0]! - segment.start[0]!) * metersPerLongitude;
	const pointY = (point[1]! - segment.start[1]!) * metersPerLatitude;
	const lengthSquared = segmentX * segmentX + segmentY * segmentY;
	const t = clampParameter(
		Math.max(
			0,
			Math.min(1, lengthSquared ? (pointX * segmentX + pointY * segmentY) / lengthSquared : 0)
		)
	);
	const projectedX = segmentX * t;
	const projectedY = segmentY * t;

	return {
		t,
		position: positionOnSegment(segment, t),
		distanceM: Math.hypot(pointX - projectedX, pointY - projectedY)
	};
}

function positionOnSegment(segment: Segment, t: number): Position {
	if (t === 0) return segment.start;
	if (t === 1) return segment.end;
	return [
		segment.start[0]! + (segment.end[0]! - segment.start[0]!) * t,
		segment.start[1]! + (segment.end[1]! - segment.start[1]!) * t
	];
}

function parameterOnSegment(position: Position, segment: Segment): number {
	const direction = subtract(segment.end, segment.start);
	return dot(subtract(position, segment.start), direction) / dot(direction, direction);
}

function isInterior(t: number): boolean {
	return t > 0 && t < 1;
}

function boxesOverlap(left: Segment, right: Segment): boolean {
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

function pointIntersection(
	left: Segment,
	right: Segment,
	leftT: number,
	rightT: number
): Extract<SegmentIntersection, { kind: 'point' }> {
	const clampedLeftT = clampParameter(leftT);
	const clampedRightT = clampParameter(rightT);
	const position =
		isInterior(clampedLeftT) && !isInterior(clampedRightT)
			? positionOnSegment(right, clampedRightT)
			: positionOnSegment(left, clampedLeftT);

	return {
		kind: 'point',
		left: { t: clampedLeftT, position },
		right: { t: clampedRightT, position }
	};
}

function intersectSegments(left: Segment, right: Segment): SegmentIntersection {
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
	const position = positionOnSegment(left, leftT);
	const rightT = clampParameter(parameterOnSegment(position, right));
	return pointIntersection(left, right, leftT, rightT);
}

function matchingSplit(segment: SourceSegment, split: SplitPoint): SplitPoint | undefined {
	return segment.splits.find(
		(candidate) =>
			Math.abs(candidate.t - split.t) <= NUMERIC_EPSILON ||
			samePosition(candidate.position, split.position)
	);
}

function addSplit(segment: SourceSegment, split: SplitPoint) {
	if (!matchingSplit(segment, split)) segment.splits.push(split);
}

function withEndpointSplits(segment: Segment): SourceSegment {
	return {
		...segment,
		splits: [
			{ t: 0, position: segment.start },
			{ t: 1, position: segment.end }
		]
	};
}

/** Copy guide points, removing consecutive duplicates and a duplicated closing position. */
function normalizeGuidePoints(guide: GuidePath): Position[] {
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
		const points = normalizeGuidePoints(guide);
		const minimumPoints = guide.closed ? 3 : 2;
		if (points.length < minimumPoints) continue;
		const segmentCount = guide.closed ? points.length : points.length - 1;
		for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
			const start = points[segmentIndex]!;
			const end = points[(segmentIndex + 1) % points.length]!;
			segments.push(withEndpointSplits({ guideIndex, segmentIndex, start, end }));
		}
	}
	return segments;
}

function splitSegments(segments: Iterable<SourceSegment>): Segment[] {
	const pieces: Segment[] = [];
	for (const { guideIndex, segmentIndex, splits } of segments) {
		splits.sort((left, right) => left.t - right.t);
		for (let index = 1; index < splits.length; index++) {
			const start = splits[index - 1]!.position;
			const end = splits[index]!.position;
			if (!samePosition(start, end)) pieces.push({ guideIndex, segmentIndex, start, end });
		}
	}
	return pieces;
}

function comparePositions(left: Position, right: Position): number {
	return left[0]! - right[0]! || left[1]! - right[1]!;
}

function orderedEndpoints(segment: Segment): [Position, Position] {
	const { start, end } = segment;
	return comparePositions(start, end) <= 0 ? [start, end] : [end, start];
}

function compareSegments(left: Segment, right: Segment): number {
	const [leftStart, leftEnd] = orderedEndpoints(left);
	const [rightStart, rightEnd] = orderedEndpoints(right);
	return comparePositions(leftStart, rightStart) || comparePositions(leftEnd, rightEnd);
}

function sameSourceSegment(left: Segment, right: Segment): boolean {
	return left.guideIndex === right.guideIndex && left.segmentIndex === right.segmentIndex;
}

function nearestSnap(
	source: SourceSegment,
	point: Position,
	segments: Map<SourceSegment, SourceSegment>,
	toleranceM: number
): Snap | undefined {
	let best: Snap | undefined;
	let bestDistance = Infinity;
	for (const [original, target] of segments) {
		// Projections use the exact geometry. A moved segment no longer offers that geometry.
		if (target !== original || sameSourceSegment(source, target)) continue;

		const projection = projectPointToSegment(point, target);
		if (projection.distanceM > toleranceM) continue;
		const distanceDifference = projection.distanceM - bestDistance;
		if (
			!best ||
			distanceDifference < -NUMERIC_EPSILON ||
			(Math.abs(distanceDifference) <= NUMERIC_EPSILON && compareSegments(target, best.target) < 0)
		) {
			best = { target, split: matchingSplit(target, projection) ?? projection };
			bestDistance = projection.distanceM;
		}
	}
	return best;
}

function applySnaps(
	source: SourceSegment,
	startSnap: Snap | undefined,
	endSnap: Snap | undefined,
	segments: Map<SourceSegment, SourceSegment>,
	locked: Set<SourceSegment>
) {
	if (!startSnap && !endSnap) return;
	// Two projections onto one straight source segment would retrace part of that segment.
	if (startSnap && endSnap && sameSourceSegment(startSnap.target, endSnap.target)) return;

	const start = startSnap?.split.position ?? source.start;
	const end = endSnap?.split.position ?? source.end;
	if (samePosition(start, end)) return;

	const moved = withEndpointSplits({
		guideIndex: source.guideIndex,
		segmentIndex: source.segmentIndex,
		start,
		end
	});
	const crossings: { target: SourceSegment; left: SplitPoint; right: SplitPoint }[] = [];
	for (const [original, other] of segments) {
		if (original === source) continue;
		const intersection = intersectSegments(moved, other);
		if (intersection.kind === 'overlap') return;
		if (intersection.kind !== 'point' || other === startSnap?.target || other === endSnap?.target) {
			continue;
		}
		const { left, right } = intersection;
		const existingSharedEndpoint =
			!isInterior(left.t) &&
			!isInterior(right.t) &&
			samePosition(positionOnSegment(source, left.t), left.position);
		if (!existingSharedEndpoint) {
			crossings.push({ target: other, left, right });
		}
	}

	segments.set(source, moved);
	// Record the projected junction explicitly and keep its host fixed for later snaps.
	for (const snap of [startSnap, endSnap]) {
		if (!snap) continue;
		addSplit(snap.target, snap.split);
		locked.add(snap.target);
	}
	for (const { target, left, right } of crossings) {
		addSplit(moved, left);
		addSplit(target, right);
		locked.add(target);
	}
}

function snapNearEndpoints(pieces: Segment[], toleranceM: number): Segment[] {
	if (!Number.isFinite(toleranceM) || toleranceM <= 0) return pieces;

	const degree = new Map<string, number>();
	for (const { start, end } of pieces) {
		for (const position of [start, end]) {
			const key = positionKey(position);
			degree.set(key, (degree.get(key) ?? 0) + 1);
		}
	}
	const isDangling = (position: Position) => degree.get(positionKey(position)) === 1;
	const originals = pieces.map(withEndpointSplits);
	const segments = new Map(originals.map((segment) => [segment, segment]));
	const locked = new Set<SourceSegment>();

	// Only dangling ends can move. Resolve competing snaps by geometry instead of draw order.
	const candidates = originals
		.filter(({ start, end }) => isDangling(start) || isDangling(end))
		.sort(compareSegments);
	for (const source of candidates) {
		if (locked.has(source)) continue;
		const startSnap = isDangling(source.start)
			? nearestSnap(source, source.start, segments, toleranceM)
			: undefined;
		const endSnap = isDangling(source.end)
			? nearestSnap(source, source.end, segments, toleranceM)
			: undefined;
		applySnaps(source, startSnap, endSnap, segments, locked);
	}
	return splitSegments(segments.values());
}

/** Build an undirected graph from exact intersections and inferred near connections. */
export function buildTopologyGraph(
	guides: GuidePath[],
	options: TopologyBuildOptions = {}
): TopologyBuildResult {
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

	const pieces = snapNearEndpoints(
		splitSegments(segments),
		options.snapToleranceM ?? TOPOLOGY_SNAP_TOLERANCE_M
	);
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

	const edges = pieces.map<TopologyEdge>(({ start, end, guideIndex, segmentIndex }, id) => ({
		id,
		fromNodeId: nodeId(start),
		toNodeId: nodeId(end),
		guideIndex,
		segmentIndex
	}));
	return { ok: true, graph: { nodes, edges } };
}
