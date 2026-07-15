import type { LineString, Position } from 'geojson';
import { LOOP_CLOSE_TOLERANCE_M } from '$lib/config/routing';
import { distanceBetween, pathLength } from '$lib/geometry/distance';

export function dedupeConsecutivePositions(points: Position[]): Position[] {
	if (points.length === 0) return [];
	const out: Position[] = [points[0]!];
	for (let i = 1; i < points.length; i++) {
		const p = points[i]!;
		const prev = out[out.length - 1]!;
		if (p[0] !== prev[0] || p[1] !== prev[1]) out.push(p);
	}
	return out;
}

/** Concatenate LineString coordinate arrays without duplicating join vertices. */
export function stitchCoordinates(parts: Position[][]): Position[] {
	const out: Position[] = [];
	for (const part of parts) {
		for (const p of part) {
			const prev = out[out.length - 1];
			if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
		}
	}
	return out;
}

/**
 * For closed sketches, ensure the route returns near the start.
 * Appends the first coordinate when the ends are farther than tolerance.
 */
export function ensureClosedLoop(
	points: Position[],
	closed: boolean,
	toleranceM = LOOP_CLOSE_TOLERANCE_M
): Position[] {
	if (!closed || points.length < 2) return points;
	const first = points[0]!;
	const last = points[points.length - 1]!;
	const gap = distanceBetween(first, last);
	if (gap <= toleranceM) {
		// Snap last to first for a clean ring when already close.
		if (first[0] !== last[0] || first[1] !== last[1]) {
			return [...points.slice(0, -1), first];
		}
		return points;
	}
	return [...points, first];
}

export function toLineString(points: Position[]): LineString {
	return { type: 'LineString', coordinates: dedupeConsecutivePositions(points) };
}

export function measureRouteDistanceM(points: Position[], osrmDistanceM?: number): number {
	if (typeof osrmDistanceM === 'number' && Number.isFinite(osrmDistanceM) && osrmDistanceM > 0) {
		return osrmDistanceM;
	}
	return pathLength(points);
}
