import type { LineString, Position } from 'geojson';
import type { RouteDetour, WaypointDetourAnalysis } from './detours';
import { normalizeWaypointSelections } from './detour-coverage';
import type { WaypointActionSelection } from './types';
import type { RouteRequest, RouteVia } from '../matching/types';

export type RefinementPlan = {
	request: RouteRequest;
	nextSelections: WaypointActionSelection[];
};

export type WaypointMoveProposal = {
	waypointIndex: number;
	from: Position;
	to: Position;
	detour: RouteDetour;
};

export type DetourScore = {
	candidateCount: number;
	excessDistanceM: number;
	distanceM: number;
};

const MAX_AUTOMATIC_DISTANCE_INCREASE_RATIO = 1.1;

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

function moveTarget(
	routePoints: Position[],
	waypoint: Position,
	waypointIndex: number,
	candidate: RouteDetour
): { location: Position; routeIndex: number } {
	const routeIndex = waypointIndex === 0 ? candidate.endIndex : candidate.startIndex;
	return { location: routePoints[routeIndex] ?? waypoint, routeIndex };
}

/** Project the exact move locations used by the refinement request for map presentation. */
export function buildWaypointMoveProposals(
	geometry: LineString | null,
	waypoints: Position[],
	analysisWithSelections: WaypointDetourAnalysis[]
): WaypointMoveProposal[] {
	const routePoints = geometry?.coordinates ?? [];
	return analysisWithSelections.flatMap(({ waypointIndex, candidate, action }) => {
		const from = waypoints[waypointIndex];
		if (action !== 'move' || !candidate || !from) return [];
		return [
			{
				waypointIndex,
				from,
				to: moveTarget(routePoints, from, waypointIndex, candidate).location,
				detour: candidate
			}
		];
	});
}

/**
 * Build the request and remap explicit keep selections in one pass so waypoint
 * counts, deduplication, and the actual map-matching payload cannot drift apart.
 */
export function buildRefinementPlan(
	geometry: LineString | null,
	waypoints: Position[],
	analysisWithSelections: WaypointDetourAnalysis[],
	selections: WaypointActionSelection[] = []
): RefinementPlan {
	const routePoints = geometry?.coordinates ?? [];
	const vias: RouteVia[] = [];
	const nextSelections: WaypointActionSelection[] = [];
	const explicitlyKeptWaypointIndexes = new Set(
		normalizeWaypointSelections(analysisWithSelections, selections).flatMap(
			({ waypointIndex, action }) => (action === 'keep' ? [waypointIndex] : [])
		)
	);

	for (let index = 0; index < waypoints.length; index++) {
		const waypoint = waypoints[index]!;
		const waypointAnalysis = analysisWithSelections[index]!;
		const candidate = waypointAnalysis.candidate;
		const action = waypointAnalysis.action;
		if (action === 'remove') continue;

		let via: RouteVia = { location: waypoint };
		if (action === 'move') {
			if (candidate) {
				const target = moveTarget(routePoints, waypoint, index, candidate);
				const routeIndex = target.routeIndex;
				const bearing = bearingAtRouteIndex(routePoints, routeIndex);
				via = {
					location: target.location,
					radiusM: 20,
					...(bearing == null ? {} : { bearing, bearingRange: 45 })
				};
			}
		}

		const previous = vias[vias.length - 1];
		if (!previous || !samePosition(previous.location, via.location)) {
			vias.push(via);
		}

		if (explicitlyKeptWaypointIndexes.has(waypointAnalysis.waypointIndex)) {
			nextSelections.push({ waypointIndex: vias.length - 1, action: 'keep' });
		}
	}

	return {
		request: { vias },
		nextSelections
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

/** Hash every field that can change the map-matching request used by automatic refinement. */
export function routeRequestHash(request: RouteRequest): string {
	return JSON.stringify({
		vias: request.vias.map(({ location, radiusM, bearing, bearingRange }) => [
			location[0],
			location[1],
			radiusM ?? null,
			bearing ?? null,
			bearingRange ?? null
		])
	});
}
