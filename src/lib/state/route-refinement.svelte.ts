import type { LineString, Position } from 'geojson';
import { MIN_VIAS } from '$lib/config/routing';
import {
	analyzeRouteDetours,
	getWaypointDetourAnalysis,
	mergeRouteDetourCandidates,
	type RouteDetour,
	type WaypointDetourAnalysis
} from '$lib/routing/refinement/detours';
import {
	buildRefinementPlan,
	getWaypointRefinementAction,
	type RefinementPlan
} from '$lib/routing/refinement/plan';
import type { WaypointRefinementAction } from '$lib/routing/refinement/types';

type RouteRefinementSources = {
	getRouteGeometry: () => LineString | null;
	getWaypoints: () => Position[];
};

export function createRouteRefinementState({
	getRouteGeometry,
	getWaypoints
}: RouteRefinementSources) {
	let actionOverrides = $state<Record<number, WaypointRefinementAction>>({});

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

	function action(index: number): WaypointRefinementAction {
		return getWaypointRefinementAction(waypointAnalysis(index), actionOverrides[index]);
	}

	const actionCounts = $derived.by(() => {
		let move = 0;
		let remove = 0;

		for (let index = 0; index < getWaypoints().length; index++) {
			const waypointAction = action(index);
			if (waypointAction === 'move') move += 1;
			if (waypointAction === 'remove') remove += 1;
		}

		return { move, remove, pending: move + remove };
	});

	const plan: RefinementPlan = $derived.by(() =>
		buildRefinementPlan(getRouteGeometry(), getWaypoints(), analysis, actionOverrides)
	);

	const detours: RouteDetour[] = $derived.by(() => {
		const routeGeometry = getRouteGeometry();
		if (!routeGeometry) return [];

		const candidates = analysis.flatMap(({ waypointIndex, candidate }) =>
			action(waypointIndex) === 'move' && candidate ? [candidate] : []
		);
		return mergeRouteDetourCandidates(routeGeometry, candidates);
	});

	const canRefineCurrentResult = $derived(
		getRouteGeometry() != null && actionCounts.pending > 0 && plan.request.vias.length >= MIN_VIAS
	);

	function reset() {
		actionOverrides = {};
	}

	function replaceOverrides(preservedOverrides: Record<number, WaypointRefinementAction> = {}) {
		actionOverrides = { ...preservedOverrides };
	}

	function cycle(index: number): WaypointRefinementAction | null {
		if (!Number.isInteger(index) || index < 0 || index >= getWaypoints().length) return null;

		const actions: WaypointRefinementAction[] = hasCandidate(index)
			? ['move', 'remove', 'keep']
			: ['keep', 'remove'];
		const current = action(index);
		const next = actions[(actions.indexOf(current) + 1) % actions.length]!;
		if (next === waypointAnalysis(index).recommendedAction) {
			delete actionOverrides[index];
		} else {
			actionOverrides[index] = next;
		}
		return next;
	}

	return {
		get actionCounts() {
			return actionCounts;
		},
		get plan() {
			return plan;
		},
		get detours() {
			return detours;
		},
		get canRefineCurrentResult() {
			return canRefineCurrentResult;
		},
		hasCandidate,
		action,
		reset,
		replaceOverrides,
		cycle
	};
}
