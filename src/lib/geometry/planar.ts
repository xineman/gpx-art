import type { Position } from 'geojson';

/** Parameter and cross-product tolerance for planar segment math. */
export const NUMERIC_EPSILON = 1e-12;

/** A straight segment in lng/lat degrees. */
export type PlanarSegment = {
	start: Position;
	end: Position;
};

/** A position on a segment and its parameter from `start` (0) to `end` (1). */
export type SplitPoint = {
	t: number;
	position: Position;
};

export type SegmentIntersection =
	{ kind: 'none' } | { kind: 'point'; left: SplitPoint; right: SplitPoint } | { kind: 'overlap' };

export type SegmentProjection = SplitPoint & {
	distanceM: number;
};

export function cross(left: Position, right: Position): number {
	return left[0]! * right[1]! - left[1]! * right[0]!;
}

export function dot(left: Position, right: Position): number {
	return left[0]! * right[0]! + left[1]! * right[1]!;
}

export function subtract(left: Position, right: Position): Position {
	return [left[0]! - right[0]!, left[1]! - right[1]!];
}

function scaledEpsilon(left: Position, right: Position): number {
	return (
		NUMERIC_EPSILON *
		Math.max(Math.hypot(left[0]!, left[1]!) * Math.hypot(right[0]!, right[1]!), Number.EPSILON)
	);
}

export function clampParameter(value: number): number {
	if (Math.abs(value) <= NUMERIC_EPSILON) return 0;
	if (Math.abs(1 - value) <= NUMERIC_EPSILON) return 1;
	return value;
}

export function projectPointToSegment(point: Position, segment: PlanarSegment): SegmentProjection {
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

export function positionOnSegment(segment: PlanarSegment, t: number): Position {
	if (t === 0) return segment.start;
	if (t === 1) return segment.end;
	return [
		segment.start[0]! + (segment.end[0]! - segment.start[0]!) * t,
		segment.start[1]! + (segment.end[1]! - segment.start[1]!) * t
	];
}

export function parameterOnSegment(position: Position, segment: PlanarSegment): number {
	const direction = subtract(segment.end, segment.start);
	return dot(subtract(position, segment.start), direction) / dot(direction, direction);
}

export function isInterior(t: number): boolean {
	return t > 0 && t < 1;
}

function boxesOverlap(left: PlanarSegment, right: PlanarSegment): boolean {
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
	left: PlanarSegment,
	right: PlanarSegment,
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

export function intersectSegments(left: PlanarSegment, right: PlanarSegment): SegmentIntersection {
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
