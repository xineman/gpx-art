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
	#lastFocusedMoveWaypointIndex = $state<number | null>(null);

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

	readonly moveWaypointIndexes: number[] = $derived(
		this.moveProposals.map(({ waypointIndex }) => waypointIndex)
	);
	readonly highlightedMoveWaypointIndex: number | null = $derived.by(() => {
		if (
			this.#lastFocusedMoveWaypointIndex === null ||
			!this.moveWaypointIndexes.includes(this.#lastFocusedMoveWaypointIndex)
		) {
			return null;
		}
		return this.#lastFocusedMoveWaypointIndex;
	});

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

	inspectMoveWaypoint(index: number) {
		if (this.moveWaypointIndexes.includes(index)) this.#lastFocusedMoveWaypointIndex = index;
	}

	clearMoveWaypointFocus() {
		this.#lastFocusedMoveWaypointIndex = null;
	}

	reviewMoveWaypoint(offset: number): number | null {
		if (this.moveWaypointIndexes.length === 0 || !Number.isFinite(offset)) return null;
		const currentIndex = Math.max(
			0,
			this.moveWaypointIndexes.indexOf(this.highlightedMoveWaypointIndex ?? -1)
		);
		const nextIndex =
			(currentIndex + Math.trunc(offset) + this.moveWaypointIndexes.length) %
			this.moveWaypointIndexes.length;
		this.#lastFocusedMoveWaypointIndex = this.moveWaypointIndexes[nextIndex]!;
		return this.#lastFocusedMoveWaypointIndex;
	}

	reset() {
		this.#selections = [];
		this.clearMoveWaypointFocus();
	}

	replaceSelections(nextSelections: WaypointActionSelection[] = []) {
		this.#selections = [...nextSelections];
		this.clearMoveWaypointFocus();
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
		if (next === 'move') this.#lastFocusedMoveWaypointIndex = index;
		return next;
	}
}
