import type { Position } from 'geojson';
import { positionKey } from '#lib/geometry/position.js';
import { cumulativeDistances, distanceBetween } from '#lib/geometry/distance.js';
import { projectPointToSegment } from '#lib/geometry/planar.js';
import {
	BACKTRACKING_MIN_LENGTH_M,
	BACKTRACKING_MAX_TURNAROUND_M,
	BACKTRACKING_TOLERANCE_M,
	VIA_SIMPLIFY_TOLERANCE_M
} from '../config';

type Backtrack = { start: number; tip: number; end: number; distanceM: number };

function distanceToPath(point: Position, points: Position[]): number {
	let nearest = Number.POSITIVE_INFINITY;
	for (let index = 1; index < points.length; index++) {
		nearest = Math.min(
			nearest,
			projectPointToSegment(point, {
				start: points[index - 1]!,
				end: points[index]!
			}).distanceM
		);
	}
	return nearest;
}

/**
 * Find a road followed out and back, possibly with a small turnaround loop at its end.
 * Looking for the shared stem (rather than a symmetric tip) also catches cul-de-sac loops.
 * Large loops, parallel roads and route endpoints are left alone.
 */
export function findBacktracking(points: Position[]): Backtrack[] {
	const distances = cumulativeDistances(points);
	const visits = new Map<string, number[]>();
	points.forEach((point, index) => {
		const key = positionKey(point);
		const indexes = visits.get(key) ?? [];
		indexes.push(index);
		visits.set(key, indexes);
	});
	const result: Backtrack[] = [];
	for (let start = 1; start < points.length - 2; start++) {
		const indexes = visits.get(positionKey(points[start]!))!;
		for (let visit = indexes.length - 1; visit >= 0; visit--) {
			const end = indexes[visit]!;
			if (end <= start + 1) break;
			if (end === points.length - 1) continue;
			let left = start;
			let right = end;
			while (
				left + 1 <= right - 1 &&
				distanceBetween(points[left + 1]!, points[right - 1]!) <= BACKTRACKING_TOLERANCE_M
			) {
				left++;
				right--;
			}
			const distanceM = distances[end]! - distances[start]!;
			const turnaroundM = distances[right]! - distances[left]!;
			const retracedM = distanceM - turnaroundM;
			if (
				retracedM < BACKTRACKING_MIN_LENGTH_M ||
				turnaroundM > Math.min(BACKTRACKING_MAX_TURNAROUND_M, retracedM)
			)
				continue;
			let tip = left;
			while (tip < right && distances[tip]! < (distances[start]! + distances[end]!) / 2) tip++;
			result.push({ start, tip, end, distanceM });
			// The return junction can also be the start of the next spur.
			start = end - 1;
			break;
		}
	}
	return result;
}

/** Match excursions by location, so a better total score cannot hide a new spur elsewhere. */
export function introducesBacktracking(
	previousPoints: Position[],
	nextPoints: Position[]
): boolean {
	const remaining = findBacktracking(previousPoints);
	return findBacktracking(nextPoints).some((branch) => {
		const match = remaining.findIndex(
			(old) =>
				distanceBetween(previousPoints[old.start]!, nextPoints[branch.start]!) <=
					VIA_SIMPLIFY_TOLERANCE_M &&
				distanceToPath(nextPoints[branch.tip]!, previousPoints.slice(old.start, old.end + 1)) <=
					VIA_SIMPLIFY_TOLERANCE_M &&
				branch.distanceM <= old.distanceM + BACKTRACKING_MIN_LENGTH_M
		);
		if (match < 0) return true;
		remaining.splice(match, 1);
		return false;
	});
}
