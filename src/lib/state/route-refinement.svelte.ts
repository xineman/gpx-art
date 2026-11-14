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

export class RouteRefinementState {
	#sources: RouteRefinementSources;
	#selections = $state<WaypointActionSelection[]>([]);

	constructor(sources: RouteRefinementSources) {
		this.#sources = sources;
	}

	#analysis: WaypointDetourAnalysis[] = $derived.by(() => {
		const routeGeometry = this.#sources.getRouteGeometry();
		return routeGeometry ? analyzeRouteDetours(routeGeometry, this.#sources.getWaypoints()) : [];
	});

	hasCandidate(index: number): boolean {
		return getWaypointDetourAnalysis(this.#analysis, index).candidate != null;
	}

	#analysisWithSelections: WaypointDetourAnalysis[] = $derived.by(() =>
		applySelectionsToWaypointAnalysis(this.#analysis, this.#selections)
	);

	action(index: number): WaypointRefinementAction {
		return this.#analysisWithSelections[index]?.action ?? 'keep';
	}

	readonly plan: RefinementPlan = $derived.by(() =>
		buildRefinementPlan(
			this.#sources.getRouteGeometry(),
			this.#sources.getWaypoints(),
			this.#analysisWithSelections,
			this.#selections
		)
	);

	readonly moveProposals: WaypointMoveProposal[] = $derived.by(() =>
		buildWaypointMoveProposals(
			this.#sources.getRouteGeometry(),
			this.#sources.getWaypoints(),
			this.#analysisWithSelections
		)
	);

	readonly actionCounts = $derived.by(() => {
		let move = 0;
		let remove = 0;

		for (const waypointAnalysis of this.#analysisWithSelections) {
			if (waypointAnalysis.action === 'move') move += 1;
			if (waypointAnalysis.action === 'remove') remove += 1;
		}

		return { move, remove, pending: move + remove };
	});

	readonly canRefineCurrentResult = $derived.by(
		() =>
			this.#sources.getRouteGeometry() != null &&
			this.actionCounts.pending > 0 &&
			this.plan.request.vias.length >= MIN_VIAS
	);

	reset() {
		this.#selections = [];
	}

	replaceSelections(nextSelections: WaypointActionSelection[] = []) {
		this.#selections = [...nextSelections];
	}

	cycle(index: number): WaypointRefinementAction | null {
		if (!Number.isInteger(index) || index < 0 || index >= this.#sources.getWaypoints().length)
			return null;

		const actions: WaypointRefinementAction[] = this.hasCandidate(index)
			? ['move', 'remove', 'keep']
			: ['keep', 'remove'];
		const current = this.action(index);
		const next = actions[(actions.indexOf(current) + 1) % actions.length]!;

		this.#selections = applyWaypointSelection(this.#analysis, this.#selections, {
			waypointIndex: index,
			action: next
		});
		return next;
	}
}
