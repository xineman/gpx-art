import type { Feature, FeatureCollection, LineString, Position } from 'geojson';
import { MIN_VIAS } from '$lib/config/routing';
import { downloadTextFile } from '$lib/drawing/io';
import { formatDistance } from '$lib/geometry/distance';
import { requestRouteAttributes } from '$lib/routing/attribution/client';
import type {
	AttributedRouteEdge,
	RouteAttributionSuccess,
	RouteRoadSpan
} from '$lib/routing/attribution/types';
import { lineStringToGpx, routeGpxFilename } from '$lib/routing/export/gpx';
import { requestOptimizedRoute } from '$lib/routing/generate-route';
import { requestRoute } from '$lib/routing/matching/client';
import type { RouteResponse, RouteSuccess } from '$lib/routing/matching/types';
import { prepareRouteShapes } from '$lib/routing/preparation/prepare-shapes';
import { buildRouteMapFeatures } from '$lib/routing/presentation/map-features';
import { refineRouteAutomatically } from '$lib/routing/refinement/auto-refine';
import type { WaypointRefinementAction } from '$lib/routing/refinement/types';
import { supersededFailure } from '$lib/routing/shared/failure';
import {
	createLatestOperation,
	type LatestOperationLease
} from '$lib/routing/shared/latest-operation';
import { createRouteRefinementState } from './route-refinement.svelte';

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';
export type RouteLoadingAction = 'generate' | 'refine' | 'reset' | null;

type ActiveRouteLoadingAction = Exclude<RouteLoadingAction, null>;
type RoutePhase =
	| { status: Exclude<RouteStatus, 'loading'>; action: null }
	| { status: 'loading'; action: ActiveRouteLoadingAction };
type AcceptedRoute = RouteSuccess & { refined: boolean };

let phase = $state<RoutePhase>({ status: 'idle', action: null });
let acceptedRoute = $state<AcceptedRoute | null>(null);
let attribution = $state<RouteAttributionSuccess | null>(null);
let activeRoadSpanIndex = $state<number | null>(null);
const routeOperations = createLatestOperation();

/** Sketch revision bound to the current route or in-flight route attempt. */
let routeSketchRevision: number | null = null;

const geometry: LineString | null = $derived(
	attribution?.geometry ?? acceptedRoute?.geometry ?? null
);
/** Map-matched positions for the current or preserved route. */
const waypoints: Position[] = $derived(acceptedRoute?.waypoints ?? []);
const distanceM = $derived(attribution?.distanceM ?? acceptedRoute?.distanceM ?? 0);
const hasRefinedRoute = $derived(acceptedRoute?.refined ?? false);
const roadEdges: AttributedRouteEdge[] = $derived(attribution?.roadEdges ?? []);
const roadSpans: RouteRoadSpan[] = $derived(attribution?.roadSpans ?? []);
const activeRoadSpan: RouteRoadSpan | null = $derived(
	activeRoadSpanIndex === null ? null : (roadSpans[activeRoadSpanIndex] ?? null)
);
const isLoading = $derived(phase.status === 'loading');
const isReady = $derived(phase.status === 'ready' && acceptedRoute != null);
const distanceLabel = $derived(formatDistance(distanceM));

const refinement = createRouteRefinementState({
	getGeometry: () => geometry,
	getWaypoints: () => waypoints
});

const canRefineRoute = $derived(isReady && refinement.canRefineCurrentResult);

function clearRouteData() {
	acceptedRoute = null;
	attribution = null;
	refinement.reset();
	activeRoadSpanIndex = null;
}

function resetRoute(nextStatus: Extract<RouteStatus, 'idle' | 'error'>) {
	clearRouteData();
	routeSketchRevision = null;
	phase = { status: nextStatus, action: null };
}

function acceptRoute(
	result: RouteSuccess,
	refined: boolean,
	preservedOverrides: Record<number, WaypointRefinementAction> = {}
) {
	acceptedRoute = { ...result, refined };
	attribution = null;
	refinement.replaceOverrides(preservedOverrides);
	activeRoadSpanIndex = null;
	phase = { status: 'ready', action: null };
}

async function runPreparedRouteRequest(
	operation: LatestOperationLease,
	request: (signal: AbortSignal) => Promise<RouteResponse>,
	revision: number,
	action: ActiveRouteLoadingAction,
	options: {
		preserveCurrent: boolean;
		refined: boolean;
		preservedOverrides?: Record<number, WaypointRefinementAction>;
	}
): Promise<RouteResponse> {
	phase = { status: 'loading', action };
	routeSketchRevision = revision;

	if (!options.preserveCurrent) {
		clearRouteData();
	}

	const result = await request(operation.signal);
	if (!operation.isCurrent()) return supersededFailure();

	if (!result.ok) {
		if (options.preserveCurrent && acceptedRoute) {
			phase = { status: 'ready', action: null };
			return result;
		}

		resetRoute('error');
		return result;
	}

	acceptRoute(result, options.refined, options.preservedOverrides);
	return result;
}

async function attributeReadyRoute(
	operation: LatestOperationLease,
	action: ActiveRouteLoadingAction
): Promise<RouteResponse> {
	if (!acceptedRoute || !geometry) return { ok: false, error: 'No route found.' };
	const geometryToAttribute = geometry;
	const routedWaypoints = [...waypoints];
	phase = { status: 'loading', action };

	const attributed = await requestRouteAttributes(geometryToAttribute, {
		signal: operation.signal
	});
	if (!operation.isCurrent()) return supersededFailure();
	if (!attributed.ok) {
		phase = { status: 'ready', action: null };
		return attributed;
	}

	attribution = attributed;
	activeRoadSpanIndex = null;
	phase = { status: 'ready', action: null };
	const result: RouteSuccess = {
		ok: true,
		geometry: attributed.geometry,
		distanceM: attributed.distanceM,
		waypoints: routedWaypoints
	};
	return result;
}

async function refineAutomatically(operation: LatestOperationLease, initialRoute: RouteSuccess) {
	phase = { status: 'loading', action: 'generate' };

	const outcome = await refineRouteAutomatically(initialRoute, async (request) => {
		const response = await requestRoute(request, { signal: operation.signal });
		return operation.isCurrent() ? response : supersededFailure();
	});
	if (!operation.isCurrent()) return supersededFailure();

	acceptRoute(outcome.route, outcome.refined);
	return outcome.response;
}

const collection: FeatureCollection = $derived.by(() =>
	buildRouteMapFeatures({
		geometry,
		waypoints: waypoints.map((coordinates, index) => ({
			coordinates,
			candidate: refinement.hasCandidate(index),
			action: refinement.action(index)
		})),
		detours: refinement.detours,
		activeRoadSpan,
		interactive: isReady
	})
);

export const route = {
	get status() {
		return phase.status;
	},
	get loadingAction() {
		return phase.action;
	},
	get isLoading() {
		return isLoading;
	},
	get isReady() {
		return isReady;
	},
	get hasRefinedRoute() {
		return hasRefinedRoute;
	},
	get moveWaypointCount() {
		return refinement.actionCounts.move;
	},
	get removeWaypointCount() {
		return refinement.actionCounts.remove;
	},
	get pendingWaypointCount() {
		return refinement.actionCounts.pending;
	},
	get canRefineRoute() {
		return canRefineRoute;
	},
	get roadEdges(): AttributedRouteEdge[] {
		return roadEdges;
	},
	get roadSpans(): RouteRoadSpan[] {
		return roadSpans;
	},
	get activeRoadSpanIndex() {
		return activeRoadSpanIndex;
	},
	inspectRoadSpan(index: number | null) {
		activeRoadSpanIndex =
			index !== null && Number.isInteger(index) && index >= 0 && index < roadSpans.length
				? index
				: null;
	},
	/**
	 * Map source data: base route, display-only detour overlays, and via points.
	 */
	get collection(): FeatureCollection {
		return collection;
	},
	get distanceLabel() {
		return distanceLabel;
	},
	async generate(features: Feature[], revision: number, options: { autoRefine?: boolean } = {}) {
		const operation = routeOperations.begin();
		if (features.length === 0) {
			const error = 'Sketch a shape first.';
			resetRoute('error');
			return { ok: false as const, error };
		}

		const prepared = prepareRouteShapes(features);
		if (!prepared.ok) {
			resetRoute('error');
			return prepared;
		}

		const result = await runPreparedRouteRequest(
			operation,
			(signal) => requestOptimizedRoute(prepared.shapes, { signal }),
			revision,
			'generate',
			{
				preserveCurrent: false,
				refined: false
			}
		);
		if (!result.ok) return result;
		if (options.autoRefine) {
			const refined = await refineAutomatically(operation, result);
			if (!refined.ok) return refined;
		}
		return attributeReadyRoute(operation, 'generate');
	},
	async refineRoute(): Promise<RouteResponse> {
		if (!isReady || routeSketchRevision == null) {
			return { ok: false, error: 'Generate a route first.' };
		}
		if (refinement.actionCounts.pending === 0) {
			return { ok: false, error: 'Choose at least one waypoint action to refine the route.' };
		}

		const plan = refinement.plan;
		if (plan.request.vias.length < MIN_VIAS) {
			return { ok: false, error: `Keep at least ${MIN_VIAS} waypoints to refine the route.` };
		}

		const revision = routeSketchRevision;
		const operation = routeOperations.begin();
		const result = await runPreparedRouteRequest(
			operation,
			(signal) => requestRoute(plan.request, { signal }),
			revision,
			'refine',
			{
				preserveCurrent: true,
				refined: true,
				preservedOverrides: plan.preservedOverrides
			}
		);
		return result.ok ? attributeReadyRoute(operation, 'refine') : result;
	},
	async resetFromSketch(features: Feature[], revision: number): Promise<RouteResponse> {
		if (!isReady || !hasRefinedRoute) {
			return { ok: false, error: 'Refine the route first.' };
		}

		const prepared = prepareRouteShapes(features);
		if (!prepared.ok) {
			return prepared;
		}

		const operation = routeOperations.begin();
		const result = await runPreparedRouteRequest(
			operation,
			(signal) => requestOptimizedRoute(prepared.shapes, { signal }),
			revision,
			'reset',
			{
				preserveCurrent: true,
				refined: false
			}
		);
		return result.ok ? attributeReadyRoute(operation, 'reset') : result;
	},
	/** Advance one ready route waypoint through its available refinement actions. */
	cycleWaypointAction(index: number): WaypointRefinementAction | null {
		if (!isReady) return null;
		return refinement.cycle(index);
	},
	/** Drop route when the drawing revision no longer matches what produced it. */
	syncSketch(revision: number) {
		if (routeSketchRevision == null) return;
		if (revision !== routeSketchRevision) {
			routeOperations.supersede();
			resetRoute('idle');
		}
	},
	/** Download GPX for the current route (no-op when not ready). */
	downloadGpx() {
		if (!geometry) return;
		const text = lineStringToGpx(geometry);
		downloadTextFile(routeGpxFilename(), text, 'application/gpx+xml');
	}
};
