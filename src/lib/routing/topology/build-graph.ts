import type { Position } from 'geojson';
import { distanceBetween } from '#lib/geometry/distance.js';
import { TOPOLOGY_SNAP_TOLERANCE_M } from '../config';
import type { GuidePath } from '../preparation/types';

const NUMERIC_EPSILON = 1e-12;
const COORDINATE_PRECISION = 12;
/**
 * Splits on one segment closer than this on both axes (degrees, about 0.1 mm) are one point. It
 * absorbs rounding in intersections of nearly parallel segments, which grows as the angle shrinks.
 */
const POSITION_EPSILON = 1e-9;
/**
 * Free ends ignore geometry reachable within this multiple of the snap tolerance along the drawing:
 * that geometry is the stroke's own tail, and snapping onto it would close a tiny loop.
 */
const LOCAL_PATH_FACTOR = 2;

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
	/** Gaps up to this length are closed, and dead-end stubs up to it are trimmed. */
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

/** A piece endpoint with no other incident piece. Snapping may move it. */
type FreeEnd = {
	key: string;
	position: Position;
	piece: number;
	atStart: boolean;
	/** Graph distances to nodes reachable along the drawing within the local-path radius. */
	nearby: Map<string, number>;
};

type HostSplit = {
	piece: number;
	split: SplitPoint;
};

/** A free end's destination: a point on a host piece, or a point shared with other free ends. */
type SnapMove = {
	target: Position;
	host?: HostSplit;
};

type PlacedSegment = Segment & {
	piece: number;
	/** Touches a moved free end, so its geometry is new. */
	moved: boolean;
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

function findSplit(splits: SplitPoint[], split: SplitPoint): SplitPoint | undefined {
	return splits.find(
		(candidate) =>
			Math.abs(candidate.t - split.t) <= NUMERIC_EPSILON ||
			(Math.abs(candidate.position[0]! - split.position[0]!) <= POSITION_EPSILON &&
				Math.abs(candidate.position[1]! - split.position[1]!) <= POSITION_EPSILON)
	);
}

/**
 * Record a crossing on both segments. Each pair computes its own intersection, so concurrent
 * crossings differ by rounding noise; a crossing already recorded on either segment wins so every
 * segment through that point splits at the same position.
 */
function addCrossing(
	left: SourceSegment,
	right: SourceSegment,
	intersection: Extract<SegmentIntersection, { kind: 'point' }>
) {
	const leftExisting = findSplit(left.splits, intersection.left);
	const rightExisting = findSplit(right.splits, intersection.right);
	const position = (leftExisting ?? rightExisting ?? intersection.left).position;
	if (!leftExisting) left.splits.push({ t: intersection.left.t, position });
	if (!rightExisting) right.splits.push({ t: intersection.right.t, position });
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

type PieceGraph = Map<string, { key: string; lengthM: number }[]>;

function pieceGraph(pieces: Segment[]): PieceGraph {
	const adjacency: PieceGraph = new Map();
	const link = (from: string, to: string, lengthM: number) => {
		const neighbors = adjacency.get(from);
		if (neighbors) neighbors.push({ key: to, lengthM });
		else adjacency.set(from, [{ key: to, lengthM }]);
	};
	for (const { start, end } of pieces) {
		const lengthM = distanceBetween(start, end);
		link(positionKey(start), positionKey(end), lengthM);
		link(positionKey(end), positionKey(start), lengthM);
	}
	return adjacency;
}

/** Graph distances from `origin` to every node closer than `limitM` along the pieces. */
function distancesWithin(
	adjacency: PieceGraph,
	origin: string,
	limitM: number
): Map<string, number> {
	const distances = new Map([[origin, 0]]);
	const settled = new Set<string>();
	for (;;) {
		let current: string | undefined;
		let currentDistance = Infinity;
		for (const [key, distance] of distances) {
			if (!settled.has(key) && distance < currentDistance) {
				current = key;
				currentDistance = distance;
			}
		}
		if (current == null) return distances;
		settled.add(current);
		for (const { key, lengthM } of adjacency.get(current) ?? []) {
			const distance = currentDistance + lengthM;
			if (distance < limitM && distance < (distances.get(key) ?? Infinity)) {
				distances.set(key, distance);
			}
		}
	}
}

/** Dangling piece endpoints, ordered by position so the result ignores guide order. */
function freeEnds(pieces: Segment[], localLimitM: number): FreeEnd[] {
	const incidences = new Map<string, { piece: number; atStart: boolean }[]>();
	for (const [piece, { start, end }] of pieces.entries()) {
		for (const [position, atStart] of [
			[start, true],
			[end, false]
		] as const) {
			const key = positionKey(position);
			const incident = incidences.get(key);
			if (incident) incident.push({ piece, atStart });
			else incidences.set(key, [{ piece, atStart }]);
		}
	}

	const adjacency = pieceGraph(pieces);
	const ends: FreeEnd[] = [];
	for (const [key, incident] of incidences) {
		if (incident.length !== 1) continue;
		const { piece, atStart } = incident[0]!;
		ends.push({
			key,
			position: atStart ? pieces[piece]!.start : pieces[piece]!.end,
			piece,
			atStart,
			nearby: distancesWithin(adjacency, key, localLimitM)
		});
	}
	return ends.sort((left, right) => comparePositions(left.position, right.position));
}

/** Along-drawing distance from a free end to a point on a piece; Infinity when not nearby. */
function localDistance(end: FreeEnd, piece: Segment, t: number): number {
	const lengthM = distanceBetween(piece.start, piece.end);
	return Math.min(
		(end.nearby.get(positionKey(piece.start)) ?? Infinity) + t * lengthM,
		(end.nearby.get(positionKey(piece.end)) ?? Infinity) + (1 - t) * lengthM
	);
}

function nearestHost(
	point: Position,
	pieces: Segment[],
	toleranceM: number,
	accepts: (piece: Segment, projection: SegmentProjection) => boolean
): HostSplit | undefined {
	let best: (HostSplit & { distanceM: number }) | undefined;
	for (const [index, piece] of pieces.entries()) {
		const projection = projectPointToSegment(point, piece);
		if (projection.distanceM > toleranceM || !accepts(piece, projection)) continue;
		const distanceDifference = projection.distanceM - (best?.distanceM ?? Infinity);
		if (
			!best ||
			distanceDifference < -NUMERIC_EPSILON ||
			(Math.abs(distanceDifference) <= NUMERIC_EPSILON &&
				compareSegments(piece, pieces[best.piece]!) < 0)
		) {
			best = {
				piece: index,
				split: { t: projection.t, position: projection.position },
				distanceM: projection.distanceM
			};
		}
	}
	return best;
}

/**
 * Group free ends that are mutually within tolerance, closest pairs first. A group only grows while
 * every pair inside it stays within tolerance, so its members stay close to their shared point.
 */
function nearEndGroups(ends: FreeEnd[], toleranceM: number): FreeEnd[][] {
	const pairs: { left: number; right: number; distanceM: number }[] = [];
	const close = new Set<string>();
	for (let left = 0; left < ends.length; left++) {
		for (let right = left + 1; right < ends.length; right++) {
			const distanceM = distanceBetween(ends[left]!.position, ends[right]!.position);
			if (distanceM > toleranceM || ends[left]!.nearby.has(ends[right]!.key)) continue;
			pairs.push({ left, right, distanceM });
			close.add(`${left},${right}`);
		}
	}
	pairs.sort(
		(first, second) =>
			first.distanceM - second.distanceM || first.left - second.left || first.right - second.right
	);

	const groups = ends.map((_, index) => [index]);
	for (const { left, right } of pairs) {
		const leftGroup = groups[left]!;
		const rightGroup = groups[right]!;
		if (leftGroup === rightGroup) continue;
		const allClose = leftGroup.every((first) =>
			rightGroup.every((second) =>
				close.has(first < second ? `${first},${second}` : `${second},${first}`)
			)
		);
		if (!allClose) continue;
		const merged = [...leftGroup, ...rightGroup];
		for (const index of merged) groups[index] = merged;
	}
	return [...new Set(groups)]
		.filter((group) => group.length > 1)
		.map((group) => group.map((index) => ends[index]!));
}

function centroid(points: Position[]): Position {
	let longitude = 0;
	let latitude = 0;
	for (const point of points) {
		longitude += point[0]!;
		latitude += point[1]!;
	}
	return [longitude / points.length, latitude / points.length];
}

/** Choose every free end's destination against the unmoved pieces. */
function planSnaps(pieces: Segment[], ends: FreeEnd[], toleranceM: number): Map<FreeEnd, SnapMove> {
	const localLimitM = LOCAL_PATH_FACTOR * toleranceM;
	const moves = new Map<FreeEnd, SnapMove>();

	// Mutually near ends (the apex of an "A") meet at one point instead of one hitting the other's side.
	for (const group of nearEndGroups(ends, toleranceM)) {
		const center = centroid(group.map(({ position }) => position));
		const host = nearestHost(center, pieces, toleranceM, (piece, projection) =>
			group.every(
				(end) =>
					localDistance(end, piece, projection.t) >= localLimitM &&
					distanceBetween(end.position, projection.position) <= toleranceM
			)
		);
		const move: SnapMove = host ? { target: host.split.position, host } : { target: center };
		for (const end of group) moves.set(end, move);
	}

	for (const end of ends) {
		if (moves.has(end)) continue;
		const host = nearestHost(
			end.position,
			pieces,
			toleranceM,
			(piece, projection) => localDistance(end, piece, projection.t) >= localLimitM
		);
		if (host) moves.set(end, { target: host.split.position, host });
	}
	return moves;
}

/**
 * Apply all moves together. A piece runs from its (moved) start through every host split to its
 * (moved) end, so a host whose own free end moves bends at the junctions it received.
 */
function placeSegments(
	pieces: Segment[],
	moves: Map<FreeEnd, SnapMove>
): { placed: PlacedSegment[]; collapsed: Set<number> } {
	const hostSplits = pieces.map((): SplitPoint[] => []);
	const movedStarts = new Map<number, Position>();
	const movedEnds = new Map<number, Position>();
	for (const [end, { target, host }] of moves) {
		let position = target;
		if (host) {
			const splits = hostSplits[host.piece]!;
			const existing = findSplit(splits, host.split);
			if (!existing) splits.push(host.split);
			position = (existing ?? host.split).position;
		}
		(end.atStart ? movedStarts : movedEnds).set(end.piece, position);
	}

	const placed: PlacedSegment[] = [];
	const collapsed = new Set<number>();
	for (const [piece, { guideIndex, segmentIndex, start, end }] of pieces.entries()) {
		const movedStart = movedStarts.get(piece);
		const movedEnd = movedEnds.get(piece);
		const splits = hostSplits[piece]!.sort((left, right) => left.t - right.t);
		const vertices = [
			movedStart ?? start,
			...splits.map(({ position }) => position),
			movedEnd ?? end
		].filter((vertex, index, all) => index === 0 || !samePosition(vertex, all[index - 1]!));
		if (vertices.length < 2) {
			collapsed.add(piece);
			continue;
		}
		for (let index = 1; index < vertices.length; index++) {
			placed.push({
				guideIndex,
				segmentIndex,
				start: vertices[index - 1]!,
				end: vertices[index]!,
				piece,
				moved:
					(index === 1 && movedStart != null) || (index === vertices.length - 1 && movedEnd != null)
			});
		}
	}
	return { placed, collapsed };
}

/** Pieces whose moved geometry overlaps other geometry; such a snap was a bad idea. */
function overlappingPieces(placed: PlacedSegment[]): Set<number> {
	const rejected = new Set<number>();
	for (const [index, segment] of placed.entries()) {
		if (!segment.moved) continue;
		for (const [otherIndex, other] of placed.entries()) {
			if (otherIndex === index || intersectSegments(segment, other).kind !== 'overlap') continue;
			rejected.add(segment.piece);
			if (other.moved) rejected.add(other.piece);
		}
	}
	return rejected;
}

/** Split crossings introduced by moved segments. Unmoved segments are already noded. */
function nodePlacedSegments(placed: PlacedSegment[]): Segment[] {
	const segments = placed.map((segment) => ({
		...withEndpointSplits(segment),
		moved: segment.moved,
		keys: [positionKey(segment.start), positionKey(segment.end)]
	}));
	for (let leftIndex = 0; leftIndex < segments.length; leftIndex++) {
		const left = segments[leftIndex]!;
		for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex++) {
			const right = segments[rightIndex]!;
			// Straight segments that share an endpoint cannot cross anywhere else.
			if ((!left.moved && !right.moved) || left.keys.some((key) => right.keys.includes(key))) {
				continue;
			}
			const intersection = intersectSegments(left, right);
			if (intersection.kind !== 'point') continue;
			addCrossing(left, right, intersection);
		}
	}
	return splitSegments(segments);
}

/**
 * Move free ends within tolerance onto nearby geometry. Every destination is planned against the
 * unmoved pieces; a piece whose move would collapse it or overlap other geometry keeps its ends,
 * and the remaining ends are planned again without it.
 */
function snapFreeEnds(pieces: Segment[], toleranceM: number): Segment[] {
	if (!Number.isFinite(toleranceM) || toleranceM <= 0) return pieces;

	let ends = freeEnds(pieces, LOCAL_PATH_FACTOR * toleranceM);
	for (;;) {
		const moves = planSnaps(pieces, ends, toleranceM);
		if (!moves.size) return pieces;
		const { placed, collapsed } = placeSegments(pieces, moves);
		const rejected = overlappingPieces(placed);
		for (const piece of collapsed) rejected.add(piece);
		if (!rejected.size) return nodePlacedSegments(placed);
		ends = ends.filter(({ piece }) => !rejected.has(piece));
	}
}

/**
 * Remove dead-end chains no longer than the tolerance that hang off a junction: overshoots past a
 * crossing. Shortest chains go first, and a chain stays once its junction no longer is one, so an
 * isolated short stroke is never deleted.
 */
function trimStubs(pieces: Segment[], toleranceM: number): Segment[] {
	if (!Number.isFinite(toleranceM) || toleranceM <= 0) return pieces;

	const keys = pieces.map(({ start, end }) => [positionKey(start), positionKey(end)] as const);
	const incident = new Map<string, number[]>();
	for (const [piece, pieceKeys] of keys.entries()) {
		for (const key of pieceKeys) {
			const pieceIds = incident.get(key);
			if (pieceIds) pieceIds.push(piece);
			else incident.set(key, [piece]);
		}
	}

	const stubs: { tip: Position; junction: string; pieces: number[]; lengthM: number }[] = [];
	for (const [tipKey, tipPieces] of incident) {
		if (tipPieces.length !== 1) continue;
		let piece = tipPieces[0]!;
		const tip = keys[piece]![0] === tipKey ? pieces[piece]!.start : pieces[piece]!.end;
		const chain: number[] = [];
		let node = tipKey;
		let lengthM = 0;
		for (;;) {
			chain.push(piece);
			lengthM += distanceBetween(pieces[piece]!.start, pieces[piece]!.end);
			if (lengthM > toleranceM) break;
			const [startKey, endKey] = keys[piece]!;
			node = node === startKey ? endKey : startKey;
			const next = incident.get(node)!;
			if (next.length >= 3) stubs.push({ tip, junction: node, pieces: chain, lengthM });
			if (next.length !== 2) break;
			piece = next[0] === piece ? next[1]! : next[0]!;
		}
	}
	stubs.sort(
		(left, right) => left.lengthM - right.lengthM || comparePositions(left.tip, right.tip)
	);

	const removed = new Set<number>();
	for (const { junction, pieces: chain } of stubs) {
		const junctionPieces = incident.get(junction)!.filter((piece) => !removed.has(piece));
		if (junctionPieces.length < 3) continue;
		for (const piece of chain) removed.add(piece);
	}
	return removed.size ? pieces.filter((_, piece) => !removed.has(piece)) : pieces;
}

/**
 * Build an undirected graph from exact intersections and inferred near connections, without
 * short dead-end stubs that hang off junctions.
 */
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
			addCrossing(left, right, intersection);
		}
	}

	const toleranceM = options.snapToleranceM ?? TOPOLOGY_SNAP_TOLERANCE_M;
	const pieces = trimStubs(snapFreeEnds(splitSegments(segments), toleranceM), toleranceM);
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
