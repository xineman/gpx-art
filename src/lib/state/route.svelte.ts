import type { Feature, FeatureCollection, LineString, Position } from 'geojson';
import { MIN_VIAS } from '#lib/config/routing.js';
import { downloadTextFile } from '#lib/drawing/io.js';
import { formatDistance } from '#lib/geometry/distance.js';
import { requestRouteAttributes } from '#lib/routing/attribution/client.js';
import type {
	AttributedRouteEdge,
	RouteAttributionSuccess,
	RouteRoadSpan
} from '#lib/routing/attribution/types.js';
import { lineStringToGpx, routeGpxFilename } from '#lib/routing/export/gpx.js';
import { requestOptimizedRoute } from '#lib/routing/generate-route.js';
import { requestRoute } from '#lib/routing/matching/client.js';
import type { RouteResponse, RouteSuccess } from '#lib/routing/matching/types.js';
import { prepareRouteShapes } from '#lib/routing/preparation/prepare-shapes.js';
import { buildRouteMapFeatures } from '#lib/routing/presentation/map-features.js';
import { refineRouteAutomatically } from '#lib/routing/refinement/auto-refine.js';
import type {
	WaypointActionSelection,
	WaypointRefinementAction
} from '#lib/routing/refinement/types.js';
import { supersededFailure } from '#lib/routing/shared/failure.js';
import {
	createLatestOperation,
	type LatestOperationScope
} from '#lib/routing/shared/latest-operation.js';
import { RouteRefinementState } from './route-refinement.svelte';

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';
export type RouteLoadingAction = 'generate' | 'refine' | 'reset' | null;

type ActiveRouteLoadingAction = Exclude<RouteLoadingAction, null>;
type RoutePhase =
	| { status: Exclude<RouteStatus, 'loading'>; action: null }
	| { status: 'loading'; action: ActiveRouteLoadingAction };
type AcceptedRoute = RouteSuccess & { refined: boolean };

class RouteState {
	#phase = $state<RoutePhase>({ status: 'idle', action: null });
	#acceptedRoute = $state<AcceptedRoute | null>(null);
	#attribution = $state<RouteAttributionSuccess | null>(null);
	#activeRoadSpanIndex = $state<number | null>(null);
	#routeOperations = createLatestOperation();

	/** Sketch revision bound to the current route or in-flight route attempt. */
	#routeSketchRevision: number | null = null;

	#routeGeometry: LineString | null = $derived(
		this.#attribution?.geometry ?? this.#acceptedRoute?.geometry ?? null
	);
	/** Map-matched positions for the current or preserved route. */
	#waypoints: Position[] = $derived(this.#acceptedRoute?.waypoints ?? []);
	#distanceM = $derived(this.#attribution?.distanceM ?? this.#acceptedRoute?.distanceM ?? 0);
	readonly hasRefinedRoute = $derived(this.#acceptedRoute?.refined ?? false);
	readonly roadEdges: AttributedRouteEdge[] = $derived(this.#attribution?.roadEdges ?? []);
	readonly roadSpans: RouteRoadSpan[] = $derived(this.#attribution?.roadSpans ?? []);
	#activeRoadSpan: RouteRoadSpan | null = $derived(
		this.#activeRoadSpanIndex === null ? null : (this.roadSpans[this.#activeRoadSpanIndex] ?? null)
	);
	readonly isLoading = $derived(this.#phase.status === 'loading');
	readonly isReady = $derived(this.#phase.status === 'ready' && this.#acceptedRoute != null);
	readonly distanceLabel = $derived(formatDistance(this.#distanceM));

	#refinement = new RouteRefinementState({
		getRouteGeometry: () => this.#routeGeometry,
		getWaypoints: () => this.#waypoints
	});

	#lastFocusedMoveWaypointIndex = $state<number | null>(null);
	readonly moveWaypointIndexes: number[] = $derived(
		this.#refinement.moveProposals.map(({ waypointIndex }) => waypointIndex)
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

	readonly canRefineRoute = $derived(this.isReady && this.#refinement.canRefineCurrentResult);

	#clearRouteData() {
		this.#acceptedRoute = null;
		this.#attribution = null;
		this.#refinement.reset();
		this.#lastFocusedMoveWaypointIndex = null;
		this.#activeRoadSpanIndex = null;
	}

	#resetRoute(nextStatus: Extract<RouteStatus, 'idle' | 'error'>) {
		this.#clearRouteData();
		this.#routeSketchRevision = null;
		this.#phase = { status: nextStatus, action: null };
	}

	#acceptRoute(
		result: RouteSuccess,
		options: {
			refined: boolean;
			selections?: WaypointActionSelection[];
		}
	) {
		this.#acceptedRoute = { ...result, refined: options.refined };
		this.#attribution = null;
		this.#refinement.replaceSelections(options.selections ?? []);
		this.#lastFocusedMoveWaypointIndex = null;
		this.#activeRoadSpanIndex = null;
		this.#phase = { status: 'ready', action: null };
	}

	async #attributeReadyRoute(
		operation: LatestOperationScope,
		action: ActiveRouteLoadingAction
	): Promise<RouteResponse> {
		if (!this.#acceptedRoute || !this.#routeGeometry)
			return { ok: false, error: 'No route found.' };
		const routeGeometryToAttribute = this.#routeGeometry;
		const routedWaypoints = [...this.#waypoints];
		this.#phase = { status: 'loading', action };

		const attributed = await operation.guard(
			requestRouteAttributes(routeGeometryToAttribute, {
				signal: operation.signal
			})
		);
		if (!attributed.ok) {
			this.#phase = { status: 'ready', action: null };
			return attributed;
		}

		this.#attribution = attributed;
		this.#activeRoadSpanIndex = null;
		this.#phase = { status: 'ready', action: null };
		const result: RouteSuccess = {
			ok: true,
			geometry: attributed.geometry,
			distanceM: attributed.distanceM,
			waypoints: routedWaypoints
		};
		return result;
	}

	async #refineAutomatically(operation: LatestOperationScope, initialRoute: RouteSuccess) {
		this.#phase = { status: 'loading', action: 'generate' };

		const outcome = await operation.guard(
			refineRouteAutomatically(initialRoute, (request) =>
				operation.guard(requestRoute(request, { signal: operation.signal }))
			)
		);

		this.#acceptRoute(outcome.route, { refined: outcome.refined });
		return outcome.response;
	}

	/** Map source data: base route, display-only detour overlays, and via points. */
	readonly collection: FeatureCollection = $derived.by(() =>
		buildRouteMapFeatures({
			routeGeometry: this.#routeGeometry,
			waypoints: this.#waypoints.map((coordinates, index) => ({
				coordinates,
				candidate: this.#refinement.hasCandidate(index),
				action: this.#refinement.action(index)
			})),
			moveProposals: this.#refinement.moveProposals,
			highlightedMoveWaypointIndex: this.highlightedMoveWaypointIndex,
			activeRoadSpan: this.#activeRoadSpan,
			interactive: this.isReady
		})
	);

	get status() {
		return this.#phase.status;
	}
	get loadingAction() {
		return this.#phase.action;
	}
	get moveWaypointCount() {
		return this.#refinement.actionCounts.move;
	}
	get removeWaypointCount() {
		return this.#refinement.actionCounts.remove;
	}
	get pendingWaypointCount() {
		return this.#refinement.actionCounts.pending;
	}
	get activeRoadSpanIndex() {
		return this.#activeRoadSpanIndex;
	}
	inspectRoadSpan(index: number | null) {
		this.#activeRoadSpanIndex =
			index !== null && Number.isInteger(index) && index >= 0 && index < this.roadSpans.length
				? index
				: null;
	}
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
	async generate(features: Feature[], revision: number, options: { autoRefine?: boolean } = {}) {
		return this.#routeOperations.run(async (operation) => {
			if (features.length === 0) {
				const error = 'Sketch a shape first.';
				this.#resetRoute('error');
				return { ok: false as const, error };
			}

			const prepared = prepareRouteShapes(features);
			if (!prepared.ok) {
				this.#resetRoute('error');
				return prepared;
			}

			this.#clearRouteData();
			this.#routeSketchRevision = revision;
			this.#phase = { status: 'loading', action: 'generate' };

			const result = await operation.guard(
				requestOptimizedRoute(prepared.shapes, {
					signal: operation.signal
				})
			);
			if (!result.ok) {
				this.#resetRoute('error');
				return result;
			}

			this.#acceptRoute(result, { refined: false });
			if (options.autoRefine) {
				const refined = await this.#refineAutomatically(operation, result);
				if (!refined.ok) return refined;
			}
			return this.#attributeReadyRoute(operation, 'generate');
		}, supersededFailure);
	}
	async refineRoute(): Promise<RouteResponse> {
		if (!this.isReady || this.#routeSketchRevision == null) {
			return { ok: false, error: 'Generate a route first.' };
		}
		if (this.#refinement.actionCounts.pending === 0) {
			return { ok: false, error: 'Choose at least one waypoint action to refine the route.' };
		}

		const plan = this.#refinement.plan;
		if (plan.request.vias.length < MIN_VIAS) {
			return { ok: false, error: `Keep at least ${MIN_VIAS} waypoints to refine the route.` };
		}

		return this.#routeOperations.run(async (operation) => {
			this.#phase = { status: 'loading', action: 'refine' };

			const result = await operation.guard(
				requestRoute(plan.request, { signal: operation.signal })
			);
			if (!result.ok) {
				this.#phase = { status: 'ready', action: null };
				return result;
			}

			this.#acceptRoute(result, {
				refined: true,
				selections: plan.nextSelections
			});
			return this.#attributeReadyRoute(operation, 'refine');
		}, supersededFailure);
	}
	async resetFromSketch(features: Feature[], revision: number): Promise<RouteResponse> {
		if (!this.isReady || !this.hasRefinedRoute) {
			return { ok: false, error: 'Refine the route first.' };
		}

		const prepared = prepareRouteShapes(features);
		if (!prepared.ok) {
			return prepared;
		}

		return this.#routeOperations.run(async (operation) => {
			this.#routeSketchRevision = revision;
			this.#phase = { status: 'loading', action: 'reset' };

			const result = await operation.guard(
				requestOptimizedRoute(prepared.shapes, {
					signal: operation.signal
				})
			);
			if (!result.ok) {
				this.#phase = { status: 'ready', action: null };
				return result;
			}

			this.#acceptRoute(result, { refined: false });
			return this.#attributeReadyRoute(operation, 'reset');
		}, supersededFailure);
	}
	/** Advance one ready route waypoint through its available refinement actions. */
	cycleWaypointAction(index: number): WaypointRefinementAction | null {
		if (!this.isReady) return null;
		const next = this.#refinement.cycle(index);
		if (next === 'move') this.#lastFocusedMoveWaypointIndex = index;
		return next;
	}
	/** Drop route when the drawing revision no longer matches what produced it. */
	syncSketch(revision: number) {
		if (this.#routeSketchRevision == null) return;
		if (revision !== this.#routeSketchRevision) {
			this.#routeOperations.supersede();
			this.#resetRoute('idle');
		}
	}
	/** Download GPX for the current route (no-op when not ready). */
	downloadGpx() {
		if (!this.#routeGeometry) return;
		const text = lineStringToGpx(this.#routeGeometry);
		downloadTextFile(routeGpxFilename(), text, 'application/gpx+xml');
	}
}

export const route = new RouteState();
