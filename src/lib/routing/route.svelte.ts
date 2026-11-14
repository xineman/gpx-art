import type { Feature, FeatureCollection, LineString, Position } from 'geojson';
import { MIN_VIAS } from './config';
import { downloadTextFile } from '#lib/util/download.js';
import { formatDistance } from '#lib/geometry/distance.js';
import { requestRoute, requestRouteAttributes } from './api/client';
import type {
	RouteAttributionSuccess,
	RouteResponse,
	RouteRoadSpan,
	RouteSuccess
} from './api/contracts';
import { lineStringToGpx, routeGpxFilename } from './export/gpx';
import { requestOptimizedRoute } from './generate-route';
import { prepareRouteShapes } from './preparation/prepare-shapes';
import { buildRouteMapFeatures } from './presentation/map-features';
import { refineRouteAutomatically } from './refinement/auto-refine';
import type { WaypointActionSelection, WaypointRefinementAction } from './refinement/types';
import { supersededFailure } from './api/failure';
import { createLatestOperation, type LatestOperationScope } from './latest-operation';
import { RouteRefinementState } from './refinement/route-refinement.svelte';

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

	readonly moveWaypointIndexes: number[] = $derived(this.#refinement.moveWaypointIndexes);
	readonly highlightedMoveWaypointIndex: number | null = $derived(
		this.#refinement.highlightedMoveWaypointIndex
	);

	readonly canRefineRoute = $derived(this.isReady && this.#refinement.canRefineCurrentResult);

	#clearRouteData() {
		this.#acceptedRoute = null;
		this.#attribution = null;
		this.#refinement.reset();
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
		this.#activeRoadSpanIndex = null;
		this.#phase = { status: 'ready', action: null };
	}

	/** Leave loading while keeping the currently accepted route. */
	#restoreReady() {
		this.#phase = { status: 'ready', action: null };
	}

	/** Show `action` as loading, then accept the loaded route or run `onFailure`. */
	async #loadRoute(
		operation: LatestOperationScope,
		action: ActiveRouteLoadingAction,
		load: (signal: AbortSignal) => Promise<RouteResponse>,
		options: { refined: boolean; selections?: WaypointActionSelection[]; onFailure: () => void }
	): Promise<RouteResponse> {
		this.#phase = { status: 'loading', action };
		const result = await operation.guard(load(operation.signal));
		if (!result.ok) {
			options.onFailure();
			return result;
		}
		this.#acceptRoute(result, options);
		return result;
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
			this.#restoreReady();
			return attributed;
		}

		this.#attribution = attributed;
		this.#activeRoadSpanIndex = null;
		this.#restoreReady();
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
	inspectRoadSpan(index: number | null) {
		this.#activeRoadSpanIndex =
			index !== null && Number.isInteger(index) && index >= 0 && index < this.roadSpans.length
				? index
				: null;
	}
	inspectMoveWaypoint(index: number) {
		this.#refinement.inspectMoveWaypoint(index);
	}
	clearMoveWaypointFocus() {
		this.#refinement.clearMoveWaypointFocus();
	}
	reviewMoveWaypoint(offset: number): number | null {
		return this.#refinement.reviewMoveWaypoint(offset);
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
			const result = await this.#loadRoute(
				operation,
				'generate',
				(signal) => requestOptimizedRoute(prepared.shapes, { signal }),
				{ refined: false, onFailure: () => this.#resetRoute('error') }
			);
			if (!result.ok) return result;

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
			const result = await this.#loadRoute(
				operation,
				'refine',
				(signal) => requestRoute(plan.request, { signal }),
				{
					refined: true,
					selections: plan.nextSelections,
					onFailure: () => this.#restoreReady()
				}
			);
			if (!result.ok) return result;
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
			const result = await this.#loadRoute(
				operation,
				'reset',
				(signal) => requestOptimizedRoute(prepared.shapes, { signal }),
				{ refined: false, onFailure: () => this.#restoreReady() }
			);
			if (!result.ok) return result;
			return this.#attributeReadyRoute(operation, 'reset');
		}, supersededFailure);
	}
	/** Advance one ready route waypoint through its available refinement actions. */
	cycleWaypointAction(index: number): WaypointRefinementAction | null {
		if (!this.isReady) return null;
		return this.#refinement.cycle(index);
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
