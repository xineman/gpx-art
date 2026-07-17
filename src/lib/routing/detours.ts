import type { LineString, Position } from 'geojson';
import { distanceBetween } from '$lib/geometry/distance';

export type DetourDetectionOptions = {
	/** Smallest routed excursion worth calling out. */
	minRouteDistanceM: number;
	/** Smallest distance the direct entry→exit connection would save. */
	minExcessDistanceM: number;
	/** How close an excursion must return to where it started. */
	maxReturnDistanceM: number;
	/** Minimum routed distance from the waypoint to either side of the excursion. */
	minWaypointLegM: number;
	/** Limit the search around one waypoint so nearby route crossings do not form giant loops. */
	maxWaypointLegM: number;
	/** Routed distance must be this many times the entry→exit distance. */
	minStretch: number;
};

export type RouteDetour = {
	geometry: LineString;
	startIndex: number;
	endIndex: number;
	waypointIndexes: number[];
	routeDistanceM: number;
	returnDistanceM: number;
	excessDistanceM: number;
};

/** Automatic and relaxed manual candidates for one ordered OSRM waypoint. */
export type WaypointDetourAnalysis = {
	waypointIndex: number;
	automatic: RouteDetour | null;
	manual: RouteDetour | null;
};

const DEFAULT_OPTIONS: DetourDetectionOptions = {
	minRouteDistanceM: 50,
	minExcessDistanceM: 40,
	maxReturnDistanceM: 70,
	minWaypointLegM: 15,
	maxWaypointLegM: 2_500,
	minStretch: 3
};

// Lower than the automatic-detection thresholds: this only decides whether a
// selected waypoint has enough of an excursion to show and relocate. Smaller
// spans are better treated as redundant routing constraints.
const MIN_MEANINGFUL_EXCESS_DISTANCE_M = 10;
const MIN_MEANINGFUL_STRETCH = 1.05;

type DetourInterval = Omit<RouteDetour, 'geometry'>;

function candidateScore(candidate: DetourInterval): number {
	// Returning tightly to the same road is the strongest hairpin signal.
	// The excess-distance term then prefers the widest of equivalent overlaps.
	return candidate.excessDistanceM - candidate.returnDistanceM * 4;
}

/**
 * Decide whether a selected waypoint's local route span is an actual excursion
 * rather than a short, straight section around an otherwise redundant via.
 */
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
 * Match ordered, OSRM-snapped waypoints back onto the route overview.
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
	endIndex: number,
	waypointIndex: number
): DetourInterval | null {
	if (startIndex < 0 || endIndex >= points.length || startIndex >= endIndex) return null;
	const routeDistanceM = cumulative[endIndex]! - cumulative[startIndex]!;
	const returnDistanceM = distanceBetween(points[startIndex]!, points[endIndex]!);
	return {
		startIndex,
		endIndex,
		waypointIndexes: [waypointIndex],
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

function positionsDiffer(a: Position, b: Position): boolean {
	return a[0] !== b[0] || a[1] !== b[1];
}

function findDistinctBefore(
	points: Position[],
	routeIndex: number,
	lowerBound: number
): number | null {
	for (let index = routeIndex - 1; index >= lowerBound; index--) {
		if (positionsDiffer(points[index]!, points[routeIndex]!)) return index;
	}
	return null;
}

function findDistinctAfter(
	points: Position[],
	routeIndex: number,
	upperBound: number
): number | null {
	for (let index = routeIndex + 1; index <= upperBound; index++) {
		if (positionsDiffer(points[index]!, points[routeIndex]!)) return index;
	}
	return null;
}

/** Always provide the smallest ordered route span available around a collapsed via. */
function fallbackAroundWaypoint(
	points: Position[],
	cumulative: number[],
	waypointRouteIndexes: number[],
	waypointIndex: number
): DetourInterval | null {
	const routeIndex = waypointRouteIndexes[waypointIndex]!;
	const localLower = waypointRouteIndexes[waypointIndex - 1] ?? 0;
	const localUpper = waypointRouteIndexes[waypointIndex + 1] ?? points.length - 1;
	const before =
		findDistinctBefore(points, routeIndex, localLower) ?? findDistinctBefore(points, routeIndex, 0);
	const after =
		findDistinctAfter(points, routeIndex, localUpper) ??
		findDistinctAfter(points, routeIndex, points.length - 1);

	if (before != null && after != null) {
		return intervalForRange(points, cumulative, before, after, waypointIndex);
	}
	if (after != null) return intervalForRange(points, cumulative, routeIndex, after, waypointIndex);
	if (before != null)
		return intervalForRange(points, cumulative, before, routeIndex, waypointIndex);
	if (points.length >= 2) {
		return intervalForRange(points, cumulative, 0, points.length - 1, waypointIndex);
	}
	return null;
}

function analyzeIntermediateWaypoint(
	points: Position[],
	cumulative: number[],
	waypointRouteIndexes: number[],
	waypointIndex: number,
	options: DetourDetectionOptions
): Pick<WaypointDetourAnalysis, 'automatic' | 'manual'> {
	const routeIndex = waypointRouteIndexes[waypointIndex]!;
	const lowerBound = waypointRouteIndexes[waypointIndex - 1] ?? 0;
	const upperBound = waypointRouteIndexes[waypointIndex + 1] ?? points.length - 1;
	let bestAutomatic: DetourInterval | null = null;
	let bestManual: DetourInterval | null = null;

	for (let startIndex = routeIndex - 1; startIndex >= lowerBound; startIndex--) {
		const beforeWaypointM = cumulative[routeIndex]! - cumulative[startIndex]!;
		if (beforeWaypointM > options.maxWaypointLegM) break;
		if (beforeWaypointM < options.minWaypointLegM) continue;

		for (let endIndex = routeIndex + 1; endIndex <= upperBound; endIndex++) {
			const afterWaypointM = cumulative[endIndex]! - cumulative[routeIndex]!;
			if (afterWaypointM > options.maxWaypointLegM) break;
			if (afterWaypointM < options.minWaypointLegM) continue;

			const candidate = intervalForRange(points, cumulative, startIndex, endIndex, waypointIndex);
			if (!candidate) continue;

			if (isBetterCandidate(candidate, bestManual)) bestManual = candidate;
			if (
				candidate.returnDistanceM <= options.maxReturnDistanceM &&
				isBetterCandidate(candidate, bestAutomatic)
			) {
				bestAutomatic = candidate;
			}
		}
	}

	if (
		bestAutomatic &&
		(bestAutomatic.routeDistanceM < options.minRouteDistanceM ||
			bestAutomatic.excessDistanceM < options.minExcessDistanceM ||
			bestAutomatic.routeDistanceM / Math.max(bestAutomatic.returnDistanceM, 1) <
				options.minStretch)
	) {
		bestAutomatic = null;
	}

	bestManual ??= fallbackAroundWaypoint(points, cumulative, waypointRouteIndexes, waypointIndex);

	return {
		automatic: bestAutomatic ? withGeometry(points, bestAutomatic) : null,
		manual: bestManual ? withGeometry(points, bestManual) : null
	};
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

	let interval =
		bestIndex == null
			? null
			: intervalForRange(
					points,
					cumulative,
					isStart ? routeIndex : bestIndex,
					isStart ? bestIndex : routeIndex,
					waypointIndex
				);
	interval ??= fallbackAroundWaypoint(points, cumulative, waypointRouteIndexes, waypointIndex);
	return interval ? withGeometry(points, interval) : null;
}

/**
 * Analyze each waypoint once so UI overrides can reuse relaxed candidates
 * without changing which candidates pass automatic detection.
 */
export function analyzeRouteDetours(
	route: LineString,
	waypoints: Position[],
	optionOverrides: Partial<DetourDetectionOptions> = {}
): WaypointDetourAnalysis[] {
	const points = route.coordinates;
	if (points.length < 2 || waypoints.length === 0) return [];

	const options = { ...DEFAULT_OPTIONS, ...optionOverrides };
	const cumulative = cumulativeDistances(points);
	const waypointRouteIndexes = locateWaypoints(points, waypoints);

	return waypoints.map((_, waypointIndex) => {
		if (waypointIndex === 0 || waypointIndex === waypoints.length - 1) {
			return {
				waypointIndex,
				automatic: null,
				manual: analyzeEndpointWaypoint(
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
			...analyzeIntermediateWaypoint(
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
			merged.push({ ...interval, waypointIndexes: [...interval.waypointIndexes] });
			continue;
		}

		previous.endIndex = Math.max(previous.endIndex, interval.endIndex);
		previous.waypointIndexes = [
			...new Set([...previous.waypointIndexes, ...interval.waypointIndexes])
		];
		previous.routeDistanceM = cumulative[previous.endIndex]! - cumulative[previous.startIndex]!;
		previous.returnDistanceM = distanceBetween(
			points[previous.startIndex]!,
			points[previous.endIndex]!
		);
		previous.excessDistanceM = previous.routeDistanceM - previous.returnDistanceM;
	}

	return merged;
}

/** Merge selected per-waypoint candidates into display intervals. */
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

/**
 * Find waypoint-driven route excursions that return close to their entry.
 * Results only mark geometry; the original route remains untouched.
 */
export function detectRouteDetours(
	route: LineString,
	waypoints: Position[],
	optionOverrides: Partial<DetourDetectionOptions> = {}
): RouteDetour[] {
	if (route.coordinates.length < 3 || waypoints.length < 3) return [];
	const automaticCandidates = analyzeRouteDetours(route, waypoints, optionOverrides).flatMap(
		(result) => (result.automatic ? [result.automatic] : [])
	);
	return mergeRouteDetourCandidates(route, automaticCandidates);
}
