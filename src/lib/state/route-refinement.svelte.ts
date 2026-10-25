import type { LineString, Position } from 'geojson';
import { MIN_VIAS } from '#lib/config/routing.js';
import {
	analyzeRouteDetours,
	getWaypointDetourAnalysis,
	type WaypointDetourAnalysis
} from '#lib/routing/refinement/detours.js';
import {
	applyWaypointSelection,
	applySelectionsToWaypointAnalysis
} from '#lib/routing/refinement/detour-coverage.js';
import {
	buildRefinementPlan,
	buildWaypointMoveProposals,
	type RefinementPlan,
	type WaypointMoveProposal
} from '#lib/routing/refinement/plan.js';
import type {
	WaypointActionSelection,
	WaypointRefinementAction
} from '#lib/routing/refinement/types.js';

type RouteRefinementSources = {
	getRouteGeometry: () => LineString | null;
	getWaypoints: () => Position[];
};

export function createRouteRefinementState({
	getRouteGeometry,
	getWaypoints
}: RouteRefinementSources) {
	const analysis: WaypointDetourAnalysis[] = $derived.by(() => {
		const routeGeometry = getRouteGeometry();
		return routeGeometry ? analyzeRouteDetours(routeGeometry, getWaypoints()) : [];
	});

	function waypointAnalysis(index: number): WaypointDetourAnalysis {
		return getWaypointDetourAnalysis(analysis, index);
	}

	function hasCandidate(index: number): boolean {
		return waypointAnalysis(index).candidate != null;
	}

	let selections = $state<WaypointActionSelection[]>([]);
	const analysisWithSelections: WaypointDetourAnalysis[] = $derived.by(() =>
		applySelectionsToWaypointAnalysis(analysis, selections)
	);

	function action(index: number): WaypointRefinementAction {
		return analysisWithSelections[index]?.action ?? 'keep';
	}

	const plan: RefinementPlan = $derived.by(() =>
		buildRefinementPlan(getRouteGeometry(), getWaypoints(), analysisWithSelections, selections)
	);

	const moveProposals: WaypointMoveProposal[] = $derived.by(() =>
		buildWaypointMoveProposals(getRouteGeometry(), getWaypoints(), analysisWithSelections)
	);

	const actionCounts = $derived.by(() => {
		let move = 0;
		let remove = 0;

		for (const waypointAnalysis of analysisWithSelections) {
			if (waypointAnalysis.action === 'move') move += 1;
			if (waypointAnalysis.action === 'remove') remove += 1;
		}

		return { move, remove, pending: move + remove };
	});

	const canRefineCurrentResult = $derived(
		getRouteGeometry() != null && actionCounts.pending > 0 && plan.request.vias.length >= MIN_VIAS
	);

	function reset() {
		selections = [];
	}

	function replaceSelections(nextSelections: WaypointActionSelection[] = []) {
		selections = [...nextSelections];
	}

	function cycle(index: number): WaypointRefinementAction | null {
		if (!Number.isInteger(index) || index < 0 || index >= getWaypoints().length) return null;

		const actions: WaypointRefinementAction[] = hasCandidate(index)
			? ['move', 'remove', 'keep']
			: ['keep', 'remove'];
		const current = action(index);
		const next = actions[(actions.indexOf(current) + 1) % actions.length]!;

		selections = applyWaypointSelection(analysis, selections, {
			waypointIndex: index,
			action: next
		});
		return next;
	}

	return {
		get actionCounts() {
			return actionCounts;
		},
		get plan() {
			return plan;
		},
		get moveProposals() {
			return moveProposals;
		},
		get canRefineCurrentResult() {
			return canRefineCurrentResult;
		},
		hasCandidate,
		action,
		reset,
		replaceSelections,
		cycle
	};
}
