import type { WaypointActionSelection, WaypointRefinementAction } from './types';
import type { RouteDetour, WaypointDetourAnalysis } from './detours';

type CandidateMember = {
	analysisIndex: number;
	waypointIndex: number;
	candidate: RouteDetour;
};

function candidateCoversRouteIndex(candidate: RouteDetour, routeIndex: number): boolean {
	return candidate.startIndex <= routeIndex && routeIndex <= candidate.endIndex;
}

function candidateCoverageCount(analysis: WaypointDetourAnalysis[], waypointIndex: number): number {
	return analysis.reduce(
		(count, item) => count + (item.coveredByWaypointIndexes.includes(waypointIndex) ? 1 : 0),
		0
	);
}

function moveCoversWaypoint(
	analysisByWaypointIndex: Map<number, WaypointDetourAnalysis>,
	moverIndex: number,
	waypointIndex: number
): boolean {
	return (
		analysisByWaypointIndex.get(waypointIndex)?.coveredByWaypointIndexes.includes(moverIndex) ??
		false
	);
}

function selectionsConflict(
	analysisByWaypointIndex: Map<number, WaypointDetourAnalysis>,
	a: WaypointActionSelection,
	b: WaypointActionSelection
): boolean {
	if (a.waypointIndex === b.waypointIndex) return true;
	if (a.action === 'move' && b.action === 'move') {
		return (
			moveCoversWaypoint(analysisByWaypointIndex, a.waypointIndex, b.waypointIndex) ||
			moveCoversWaypoint(analysisByWaypointIndex, b.waypointIndex, a.waypointIndex)
		);
	}
	if (a.action === 'move' && b.action === 'keep') {
		return moveCoversWaypoint(analysisByWaypointIndex, a.waypointIndex, b.waypointIndex);
	}
	if (a.action === 'keep' && b.action === 'move') {
		return moveCoversWaypoint(analysisByWaypointIndex, b.waypointIndex, a.waypointIndex);
	}
	return false;
}

export function normalizeWaypointSelections(
	analysis: WaypointDetourAnalysis[],
	selections: WaypointActionSelection[]
): WaypointActionSelection[] {
	const analysisByWaypointIndex = new Map(
		analysis.map((item) => [item.waypointIndex, item] as const)
	);
	const normalized: WaypointActionSelection[] = [];

	for (const selection of selections) {
		if (
			normalized.some((newerSelection) =>
				selectionsConflict(analysisByWaypointIndex, selection, newerSelection)
			)
		) {
			continue;
		}
		normalized.push(selection);
	}

	return normalized;
}

/** Apply one user action and discard older selections that it supersedes. */
export function applyWaypointSelection(
	analysis: WaypointDetourAnalysis[],
	selections: WaypointActionSelection[],
	selection: WaypointActionSelection
): WaypointActionSelection[] {
	return normalizeWaypointSelections(analysis, [
		selection,
		...selections.filter((item) => item.waypointIndex !== selection.waypointIndex)
	]);
}

function compareCandidatePriority(
	a: CandidateMember,
	b: CandidateMember,
	analysis: WaypointDetourAnalysis[],
	preferredWaypointIndexes: number[]
): number {
	const aPreference = preferredWaypointIndexes.indexOf(a.waypointIndex);
	const bPreference = preferredWaypointIndexes.indexOf(b.waypointIndex);
	const aPreferred = aPreference >= 0;
	const bPreferred = bPreference >= 0;

	return (
		Number(bPreferred) - Number(aPreferred) ||
		(aPreferred && bPreferred ? aPreference - bPreference : 0) ||
		candidateCoverageCount(analysis, b.waypointIndex) -
			candidateCoverageCount(analysis, a.waypointIndex) ||
		b.candidate.routeDistanceM - a.candidate.routeDistanceM ||
		b.candidate.excessDistanceM - a.candidate.excessDistanceM ||
		a.waypointIndex - b.waypointIndex
	);
}

/**
 * Resolve requested waypoint actions so a selected detour removes candidate waypoints it covers.
 * Larger, broader candidates win cycles; opposite route endpoints are excluded from coverage.
 */
function resolveActionConflicts(
	analysis: WaypointDetourAnalysis[],
	requestedActions: WaypointRefinementAction[],
	preferredWaypointIndexes: number[] = [],
	protectedWaypointIndexes: Set<number> = new Set()
): WaypointRefinementAction[] {
	const analysisByWaypointIndex = new Map(
		analysis.map((item) => [item.waypointIndex, item] as const)
	);
	const result = [...requestedActions];
	const movers = analysis.flatMap((item, analysisIndex): CandidateMember[] =>
		item.candidate && result[analysisIndex] === 'move'
			? [{ analysisIndex, waypointIndex: item.waypointIndex, candidate: item.candidate }]
			: []
	);
	movers.sort((a, b) => compareCandidatePriority(a, b, analysis, preferredWaypointIndexes));

	const selectedMovers: CandidateMember[] = [];
	for (const mover of movers) {
		const conflictsWithProtectedWaypoint = [...protectedWaypointIndexes].some((waypointIndex) =>
			moveCoversWaypoint(analysisByWaypointIndex, mover.waypointIndex, waypointIndex)
		);
		if (conflictsWithProtectedWaypoint) {
			result[mover.analysisIndex] = 'remove';
			continue;
		}

		const incompatibleWithSelectedMover = selectedMovers.some(
			(selected) =>
				analysis[mover.analysisIndex]!.coveredByWaypointIndexes.includes(selected.waypointIndex) ||
				analysis[selected.analysisIndex]!.coveredByWaypointIndexes.includes(mover.waypointIndex)
		);
		if (incompatibleWithSelectedMover) {
			result[mover.analysisIndex] = 'remove';
		} else {
			selectedMovers.push(mover);
		}
	}

	const selectedMoverIndexes = new Set(selectedMovers.map(({ waypointIndex }) => waypointIndex));
	for (let index = 0; index < analysis.length; index++) {
		const item = analysis[index]!;
		if (
			!selectedMoverIndexes.has(item.waypointIndex) &&
			item.coveredByWaypointIndexes.some((waypointIndex) => selectedMoverIndexes.has(waypointIndex))
		) {
			result[index] = 'remove';
		}
	}

	return result;
}

/** Apply newest-first user selections and action conflicts to detected waypoint analysis. */
export function applySelectionsToWaypointAnalysis(
	analysis: WaypointDetourAnalysis[],
	selections: WaypointActionSelection[] = []
): WaypointDetourAnalysis[] {
	const normalizedSelections = normalizeWaypointSelections(analysis, selections);
	const selectionByWaypointIndex = new Map<number, WaypointActionSelection>();
	for (const selection of normalizedSelections) {
		selectionByWaypointIndex.set(selection.waypointIndex, selection);
	}

	const requestedActions = analysis.map(
		(item) => selectionByWaypointIndex.get(item.waypointIndex)?.action ?? item.action
	);
	const preferredMoveWaypointIndexes = normalizedSelections.flatMap(({ waypointIndex, action }) =>
		action === 'move' ? [waypointIndex] : []
	);
	const protectedWaypointIndexes = new Set(
		normalizedSelections.flatMap(({ waypointIndex, action }) =>
			action === 'keep' ? [waypointIndex] : []
		)
	);
	const actions = resolveActionConflicts(
		analysis,
		requestedActions,
		preferredMoveWaypointIndexes,
		protectedWaypointIndexes
	);

	return analysis.map((item, index) => ({
		...item,
		action: actions[index]!
	}));
}

export function applyCandidateCoverage(
	analysis: WaypointDetourAnalysis[],
	waypointRouteIndexes: number[]
): WaypointDetourAnalysis[] {
	const members = analysis.flatMap((item, analysisIndex): CandidateMember[] =>
		item.candidate
			? [{ analysisIndex, waypointIndex: item.waypointIndex, candidate: item.candidate }]
			: []
	);
	const finalWaypointIndex = analysis.length - 1;

	for (const covered of members) {
		for (const covering of members) {
			if (covered.analysisIndex === covering.analysisIndex) continue;
			const oppositeRouteEndpoints =
				(covered.waypointIndex === 0 && covering.waypointIndex === finalWaypointIndex) ||
				(covering.waypointIndex === 0 && covered.waypointIndex === finalWaypointIndex);
			// Start and end candidates have opposite directional semantics and may both need to move.
			if (oppositeRouteEndpoints) continue;

			const routeIndex = waypointRouteIndexes[covered.waypointIndex];
			if (routeIndex != null && candidateCoversRouteIndex(covering.candidate, routeIndex)) {
				analysis[covered.analysisIndex]!.coveredByWaypointIndexes.push(covering.waypointIndex);
			}
		}
	}

	const resolvedActions = applySelectionsToWaypointAnalysis(analysis);
	for (let index = 0; index < analysis.length; index++) {
		analysis[index] = {
			...analysis[index]!,
			action: resolvedActions[index]!.action
		};
	}

	return analysis;
}
