import type { LineString, Position } from 'geojson';
import type { RouteDetour, WaypointDetourAnalysis } from './detours';
import type { RouteRequest, RouteVia } from './types';

export type WaypointRefinementAction = 'keep' | 'move' | 'remove';

export type RefinementPlan = {
	request: RouteRequest;
	preservedOverrides: Record<number, WaypointRefinementAction>;
};

export type DetourScore = {
	candidateCount: number;
	excessDistanceM: number;
	distanceM: number;
};

const MAX_AUTOMATIC_DISTANCE_INCREASE_RATIO = 1.1;

export function hasWaypointDetourCandidate(
	analysis: WaypointDetourAnalysis[],
	index: number
): boolean {
	return analysis[index]?.candidate != null;
}

export function defaultWaypointRefinementAction(
	analysis: WaypointDetourAnalysis[],
	index: number
): WaypointRefinementAction {
	return hasWaypointDetourCandidate(analysis, index) ? 'move' : 'keep';
}

export function getWaypointRefinementAction(
	analysis: WaypointDetourAnalysis[],
	overrides: Record<number, WaypointRefinementAction>,
	index: number
): WaypointRefinementAction {
	return overrides[index] ?? defaultWaypointRefinementAction(analysis, index);
}

export function selectedWaypointDetourCandidate(
	analysis: WaypointDetourAnalysis[],
	overrides: Record<number, WaypointRefinementAction>,
	index: number
): RouteDetour | null {
	if (getWaypointRefinementAction(analysis, overrides, index) !== 'move') return null;
	return analysis[index]?.candidate ?? null;
}

function samePosition(a: Position, b: Position): boolean {
	return a[0] === b[0] && a[1] === b[1];
}

function bearingAtRouteIndex(points: Position[], index: number): number | undefined {
	const before = points[Math.max(0, index - 1)];
	const after = points[Math.min(points.length - 1, index + 1)];
	if (!before || !after || samePosition(before, after)) return undefined;
	const radians = Math.atan2(
		(after[0] - before[0]) * Math.cos((((before[1] + after[1]) / 2) * Math.PI) / 180),
		after[1] - before[1]
	);
	return Math.round(((radians * 180) / Math.PI + 360) % 360);
}

/**
 * Build the request and remap explicit keep choices in one pass so waypoint
 * counts, deduplication, and the actual OSRM payload cannot drift apart.
 */
export function buildRefinementPlan(
	geometry: LineString | null,
	waypoints: Position[],
	analysis: WaypointDetourAnalysis[],
	overrides: Record<number, WaypointRefinementAction>
): RefinementPlan {
	const routePoints = geometry?.coordinates ?? [];
	const vias: RouteVia[] = [];
	const preservedOverrides: Record<number, WaypointRefinementAction> = {};

	for (let index = 0; index < waypoints.length; index++) {
		const waypoint = waypoints[index]!;
		const action = getWaypointRefinementAction(analysis, overrides, index);
		if (action === 'remove') continue;

		let via: RouteVia = { location: waypoint };
		if (action === 'move') {
			const candidate = selectedWaypointDetourCandidate(analysis, overrides, index);
			if (candidate) {
				const routeIndex = index === 0 ? candidate.endIndex : candidate.startIndex;
				const bearing = bearingAtRouteIndex(routePoints, routeIndex);
				via = {
					location: routePoints[routeIndex] ?? waypoint,
					radiusM: 20,
					...(bearing == null ? {} : { bearing, bearingRange: 45 })
				};
			}
		}

		const previousIndex = vias.length - 1;
		const previous = vias[previousIndex];
		if (previous && samePosition(previous.location, via.location)) {
			if (overrides[index] === 'keep') preservedOverrides[previousIndex] = 'keep';
			continue;
		}

		if (overrides[index] === 'keep') preservedOverrides[vias.length] = 'keep';
		vias.push(via);
	}

	return {
		request: { vias, continueStraight: true },
		preservedOverrides
	};
}

export function scoreRouteDetours(
	analysis: WaypointDetourAnalysis[],
	distanceM: number
): DetourScore {
	const candidates = analysis.flatMap(({ candidate }) => (candidate ? [candidate] : []));
	return {
		candidateCount: candidates.length,
		excessDistanceM: candidates.reduce((total, candidate) => total + candidate.excessDistanceM, 0),
		distanceM
	};
}

export function improvesDetourScore(next: DetourScore, previous: DetourScore): boolean {
	if (
		previous.distanceM > 0 &&
		next.distanceM > previous.distanceM * MAX_AUTOMATIC_DISTANCE_INCREASE_RATIO
	) {
		return false;
	}
	if (next.candidateCount !== previous.candidateCount) {
		return next.candidateCount < previous.candidateCount;
	}
	if (next.excessDistanceM !== previous.excessDistanceM) {
		return next.excessDistanceM < previous.excessDistanceM;
	}
	return next.distanceM < previous.distanceM;
}

export function routeWaypointHash(waypoints: Position[]): string {
	return waypoints.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
}
