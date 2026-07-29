import type { LineString, Position } from 'geojson';
import { distanceBetween } from '$lib/geometry/distance';

export type DetourDetectionOptions = {
	/** Minimum routed distance from the waypoint to either side of the excursion. */
	minWaypointLegM: number;
	/** Limit the search around one waypoint so nearby route crossings do not form giant loops. */
	maxWaypointLegM: number;
};

export type RouteDetour = {
	geometry: LineString;
	startIndex: number;
	endIndex: number;
	routeDistanceM: number;
	returnDistanceM: number;
	excessDistanceM: number;
};

export type WaypointDetourAnalysis = {
	waypointIndex: number;
	candidate: RouteDetour | null;
};

const MIN_MEANINGFUL_EXCESS_DISTANCE_M = 10;
const MIN_MEANINGFUL_STRETCH = 1.05;

type DetourInterval = Omit<RouteDetour, 'geometry'>;

function candidateScore(candidate: DetourInterval): number {
	return candidate.excessDistanceM - candidate.returnDistanceM * 4;
}

export function isMeaningfulDetourCandidate(candidate: RouteDetour): boolean {
	return (
		candidate.excessDistanceM >= MIN_MEANINGFUL_EXCESS_DISTANCE_M &&
		candidate.routeDistanceM / Math.max(candidate.returnDistanceM, 1) >= MIN_MEANINGFUL_STRETCH
	);
}

function isBetterCandidate(candidate: DetourInterval, best: DetourInterval | null): boolean {
	return (
		!best ||
		candidateScore(candidate) > candidateScore(best) ||
		(candidateScore(candidate) === candidateScore(best) &&
			candidate.returnDistanceM < best.returnDistanceM)
	);
}

function cumulativeDistances(points: Position[]): number[] {
	const distances = [0];
	for (let index = 1; index < points.length; index++) {
		distances.push(distances[index - 1]! + distanceBetween(points[index - 1]!, points[index]!));
	}
	return distances;
}

/**
 * Match ordered, road-snapped waypoints back onto the route overview.
 * Route responses preserve waypoint order, so each search starts where the
 * previous match ended. The final waypoint searches backward to prefer the
 * route's final visit when a closed route returns to its start.
 */
function locateWaypoints(points: Position[], waypoints: Position[]): number[] {
	const indexes: number[] = [];
	let fromIndex = 0;

	for (let waypointIndex = 0; waypointIndex < waypoints.length; waypointIndex++) {
		const waypoint = waypoints[waypointIndex]!;
		const isLast = waypointIndex === waypoints.length - 1;
		let bestIndex = fromIndex;
		let bestDistance = Number.POSITIVE_INFINITY;

		if (isLast) {
			for (let index = points.length - 1; index >= fromIndex; index--) {
				const distance = distanceBetween(points[index]!, waypoint);
				if (distance < bestDistance) {
					bestDistance = distance;
					bestIndex = index;
				}
			}
		} else {
			for (let index = fromIndex; index < points.length; index++) {
				const distance = distanceBetween(points[index]!, waypoint);
				if (distance < bestDistance) {
					bestDistance = distance;
					bestIndex = index;
				}
			}
		}

		indexes.push(bestIndex);
		fromIndex = bestIndex;
	}

	return indexes;
}

function intervalForRange(
	points: Position[],
	cumulative: number[],
	startIndex: number,
	endIndex: number
): DetourInterval | null {
	if (startIndex < 0 || endIndex >= points.length || startIndex >= endIndex) return null;
	const routeDistanceM = cumulative[endIndex]! - cumulative[startIndex]!;
	const returnDistanceM = distanceBetween(points[startIndex]!, points[endIndex]!);
	return {
		startIndex,
		endIndex,
		routeDistanceM,
		returnDistanceM,
		excessDistanceM: routeDistanceM - returnDistanceM
	};
}

function withGeometry(points: Position[], interval: DetourInterval): RouteDetour {
	return {
		...interval,
		geometry: {
			type: 'LineString',
			coordinates: points.slice(interval.startIndex, interval.endIndex + 1)
		}
	};
}

function analyzeIntermediateWaypoint(
	points: Position[],
	cumulative: number[],
	waypointRouteIndexes: number[],
	waypointIndex: number,
	options: DetourDetectionOptions
): RouteDetour | null {
	const routeIndex = waypointRouteIndexes[waypointIndex]!;
	const lowerBound = waypointRouteIndexes[waypointIndex - 1] ?? 0;
	const upperBound = waypointRouteIndexes[waypointIndex + 1] ?? points.length - 1;
	let best: DetourInterval | null = null;

	for (let startIndex = routeIndex - 1; startIndex >= lowerBound; startIndex--) {
		const beforeWaypointM = cumulative[routeIndex]! - cumulative[startIndex]!;
		if (beforeWaypointM > options.maxWaypointLegM) break;
		if (beforeWaypointM < options.minWaypointLegM) continue;

		for (let endIndex = routeIndex + 1; endIndex <= upperBound; endIndex++) {
			const afterWaypointM = cumulative[endIndex]! - cumulative[routeIndex]!;
			if (afterWaypointM > options.maxWaypointLegM) break;
			if (afterWaypointM < options.minWaypointLegM) continue;

			const candidate = intervalForRange(points, cumulative, startIndex, endIndex);
			if (!candidate) continue;

			if (isBetterCandidate(candidate, best)) best = candidate;
		}
	}

	const candidate = best ? withGeometry(points, best) : null;
	return candidate && isMeaningfulDetourCandidate(candidate) ? candidate : null;
}

function analyzeEndpointWaypoint(
	points: Position[],
	cumulative: number[],
	waypointRouteIndexes: number[],
	waypointIndex: number,
	options: DetourDetectionOptions
): RouteDetour | null {
	const isStart = waypointIndex === 0;
	const routeIndex = waypointRouteIndexes[waypointIndex]!;
	const adjacentIndex = isStart
		? (waypointRouteIndexes[1] ?? points.length - 1)
		: (waypointRouteIndexes[waypointIndex - 1] ?? 0);
	let bestIndex: number | null = null;
	let bestReturnDistance = Number.POSITIVE_INFINITY;
	let bestRouteDistance = -1;

	const from = isStart ? routeIndex + 1 : adjacentIndex;
	const to = isStart ? adjacentIndex : routeIndex - 1;
	for (let index = from; index <= to; index++) {
		const routeDistanceM = isStart
			? cumulative[index]! - cumulative[routeIndex]!
			: cumulative[routeIndex]! - cumulative[index]!;
		if (routeDistanceM < options.minWaypointLegM) continue;
		if (routeDistanceM > options.maxWaypointLegM) {
			if (isStart) break;
			continue;
		}
		const returnDistanceM = distanceBetween(points[routeIndex]!, points[index]!);
		if (
			returnDistanceM < bestReturnDistance ||
			(returnDistanceM === bestReturnDistance && routeDistanceM > bestRouteDistance)
		) {
			bestIndex = index;
			bestReturnDistance = returnDistanceM;
			bestRouteDistance = routeDistanceM;
		}
	}

	if (bestIndex == null) return null;
	const interval = intervalForRange(
		points,
		cumulative,
		isStart ? routeIndex : bestIndex,
		isStart ? bestIndex : routeIndex
	);
	const candidate = interval ? withGeometry(points, interval) : null;
	return candidate && isMeaningfulDetourCandidate(candidate) ? candidate : null;
}

export function analyzeRouteDetours(
	route: LineString,
	waypoints: Position[],
	optionOverrides: Partial<DetourDetectionOptions> = {}
): WaypointDetourAnalysis[] {
	const points = route.coordinates;
	if (points.length < 2 || waypoints.length === 0) return [];

	const options: DetourDetectionOptions = {
		minWaypointLegM: 15,
		maxWaypointLegM: 2_500,
		...optionOverrides
	};
	const cumulative = cumulativeDistances(points);
	const waypointRouteIndexes = locateWaypoints(points, waypoints);

	return waypoints.map((_, waypointIndex) => {
		if (waypointIndex === 0 || waypointIndex === waypoints.length - 1) {
			return {
				waypointIndex,
				candidate: analyzeEndpointWaypoint(
					points,
					cumulative,
					waypointRouteIndexes,
					waypointIndex,
					options
				)
			};
		}

		return {
			waypointIndex,
			candidate: analyzeIntermediateWaypoint(
				points,
				cumulative,
				waypointRouteIndexes,
				waypointIndex,
				options
			)
		};
	});
}

function mergeIntervals(
	points: Position[],
	cumulative: number[],
	intervals: DetourInterval[]
): DetourInterval[] {
	const sorted = [...intervals].sort(
		(a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex
	);
	const merged: DetourInterval[] = [];

	for (const interval of sorted) {
		const previous = merged.at(-1);
		if (!previous || interval.startIndex > previous.endIndex) {
			merged.push({ ...interval });
			continue;
		}

		previous.endIndex = Math.max(previous.endIndex, interval.endIndex);
		previous.routeDistanceM = cumulative[previous.endIndex]! - cumulative[previous.startIndex]!;
		previous.returnDistanceM = distanceBetween(
			points[previous.startIndex]!,
			points[previous.endIndex]!
		);
		previous.excessDistanceM = previous.routeDistanceM - previous.returnDistanceM;
	}

	return merged;
}

export function mergeRouteDetourCandidates(
	route: LineString,
	candidates: RouteDetour[]
): RouteDetour[] {
	const points = route.coordinates;
	if (points.length < 2 || candidates.length === 0) return [];
	const cumulative = cumulativeDistances(points);
	return mergeIntervals(points, cumulative, candidates).map((interval) =>
		withGeometry(points, interval)
	);
}
