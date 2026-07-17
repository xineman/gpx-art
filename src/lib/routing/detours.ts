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

const DEFAULT_OPTIONS: DetourDetectionOptions = {
	minRouteDistanceM: 50,
	minExcessDistanceM: 40,
	maxReturnDistanceM: 70,
	minWaypointLegM: 15,
	maxWaypointLegM: 2_500,
	minStretch: 3
};

type DetourInterval = Omit<RouteDetour, 'geometry'>;

function candidateScore(candidate: DetourInterval): number {
	// Returning tightly to the same road is the strongest hairpin signal.
	// The excess-distance term then prefers the widest of equivalent overlaps.
	return candidate.excessDistanceM - candidate.returnDistanceM * 4;
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

function candidateAroundWaypoint(
	points: Position[],
	cumulative: number[],
	waypointRouteIndexes: number[],
	waypointIndex: number,
	options: DetourDetectionOptions
): DetourInterval | null {
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

			const routeDistanceM = cumulative[endIndex]! - cumulative[startIndex]!;
			const returnDistanceM = distanceBetween(points[startIndex]!, points[endIndex]!);
			if (returnDistanceM > options.maxReturnDistanceM) continue;

			const excessDistanceM = routeDistanceM - returnDistanceM;
			const candidate: DetourInterval = {
				startIndex,
				endIndex,
				waypointIndexes: [waypointIndex],
				routeDistanceM,
				returnDistanceM,
				excessDistanceM
			};

			if (
				!best ||
				candidateScore(candidate) > candidateScore(best) ||
				(candidateScore(candidate) === candidateScore(best) &&
					candidate.returnDistanceM < best.returnDistanceM)
			) {
				best = candidate;
			}
		}
	}

	if (
		!best ||
		best.routeDistanceM < options.minRouteDistanceM ||
		best.excessDistanceM < options.minExcessDistanceM ||
		best.routeDistanceM / Math.max(best.returnDistanceM, 1) < options.minStretch
	) {
		return null;
	}

	return best;
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

/**
 * Find waypoint-driven route excursions that return close to their entry.
 * Results only mark geometry; the original route remains untouched.
 */
export function detectRouteDetours(
	route: LineString,
	waypoints: Position[],
	optionOverrides: Partial<DetourDetectionOptions> = {}
): RouteDetour[] {
	const points = route.coordinates;
	if (points.length < 3 || waypoints.length < 3) return [];

	const options = { ...DEFAULT_OPTIONS, ...optionOverrides };
	const cumulative = cumulativeDistances(points);
	const waypointRouteIndexes = locateWaypoints(points, waypoints);
	const candidates: DetourInterval[] = [];

	// Start/end anchors define the route. Only intermediate vias can be optional excursions.
	for (let waypointIndex = 1; waypointIndex < waypoints.length - 1; waypointIndex++) {
		const candidate = candidateAroundWaypoint(
			points,
			cumulative,
			waypointRouteIndexes,
			waypointIndex,
			options
		);
		if (candidate) candidates.push(candidate);
	}

	return mergeIntervals(points, cumulative, candidates).map((interval) => ({
		...interval,
		geometry: {
			type: 'LineString',
			coordinates: points.slice(interval.startIndex, interval.endIndex + 1)
		}
	}));
}
