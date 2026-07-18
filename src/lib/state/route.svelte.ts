import type { Feature, FeatureCollection, LineString, Position } from 'geojson';
import { MIN_VIAS } from '$lib/config/routing';
import { downloadTextFile } from '$lib/drawing/io';
import { formatDistance } from '$lib/geometry/distance';
import { requestRoute } from '$lib/routing/client';
import {
	analyzeRouteDetours,
	mergeRouteDetourCandidates,
	type RouteDetour,
	type WaypointDetourAnalysis
} from '$lib/routing/detours';
import { lineStringToGpx, routeGpxFilename } from '$lib/routing/gpx';
import { prepareRouteVias } from '$lib/routing/prepare';
import {
	buildRefinementPlan,
	defaultWaypointRefinementAction,
	getWaypointRefinementAction,
	hasWaypointDetourCandidate,
	improvesDetourScore,
	routeRequestHash,
	scoreRouteDetours,
	selectedWaypointDetourCandidate,
	type RefinementPlan,
	type WaypointRefinementAction
} from '$lib/routing/refinement';
import type { RouteRequest, RouteResponse, RouteSuccess } from '$lib/routing/types';

export type { WaypointRefinementAction } from '$lib/routing/refinement';

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';
export type RouteLoadingAction = 'generate' | 'refine' | 'reset' | null;

export type WaypointRole = 'start' | 'via' | 'end';

let status = $state<RouteStatus>('idle');
let geometry = $state<LineString | null>(null);
let detours = $state<RouteDetour[]>([]);
let detourAnalysis = $state<WaypointDetourAnalysis[]>([]);
let waypointActionOverrides = $state<Record<number, WaypointRefinementAction>>({});
/** Prepared OSRM input while loading; OSRM-snapped positions once ready. */
let waypoints = $state<Position[]>([]);
let distanceM = $state(0);
let errorMessage = $state<string | null>(null);
/** Drawing revision used for the current/last route attempt. */
let sourceRevision = $state<number | null>(null);
let loadingAction = $state<RouteLoadingAction>(null);
let hasRefinedRoute = $state(false);
let requestId = 0;

function waypointRole(index: number, total: number): WaypointRole {
	if (index === 0) return 'start';
	if (index === total - 1) return 'end';
	return 'via';
}

function resetResult() {
	geometry = null;
	detours = [];
	detourAnalysis = [];
	waypointActionOverrides = {};
	waypoints = [];
	distanceM = 0;
	errorMessage = null;
	sourceRevision = null;
	loadingAction = null;
	hasRefinedRoute = false;
}

function showError(revision: number, message: string) {
	status = 'error';
	geometry = null;
	detours = [];
	detourAnalysis = [];
	waypointActionOverrides = {};
	waypoints = [];
	distanceM = 0;
	errorMessage = message;
	sourceRevision = revision;
	loadingAction = null;
	hasRefinedRoute = false;
}

function hasDetourCandidate(index: number): boolean {
	return hasWaypointDetourCandidate(detourAnalysis, index);
}

function defaultWaypointAction(index: number): WaypointRefinementAction {
	return defaultWaypointRefinementAction(detourAnalysis, index);
}

function waypointAction(index: number): WaypointRefinementAction {
	return getWaypointRefinementAction(detourAnalysis, waypointActionOverrides, index);
}

function actionCount(action: Exclude<WaypointRefinementAction, 'keep'>): number {
	return waypoints.filter((_, index) => waypointAction(index) === action).length;
}

function pendingWaypointCount(): number {
	return actionCount('move') + actionCount('remove');
}

function canRefine(): boolean {
	return status === 'ready' && canRefineCurrentResult();
}

function canRefineCurrentResult(): boolean {
	return (
		geometry != null &&
		pendingWaypointCount() > 0 &&
		refinementPlan().request.vias.length >= MIN_VIAS
	);
}

function rebuildDetours() {
	if (!geometry) {
		detours = [];
		return;
	}

	const candidates = detourAnalysis.flatMap((analysis) => {
		const candidate = selectedWaypointDetourCandidate(
			detourAnalysis,
			waypointActionOverrides,
			analysis.waypointIndex
		);
		return candidate ? [candidate] : [];
	});
	detours = mergeRouteDetourCandidates(geometry, candidates);
}

function refinementPlan(): RefinementPlan {
	return buildRefinementPlan(geometry, waypoints, detourAnalysis, waypointActionOverrides);
}

function requestFromPositions(points: Position[]): RouteRequest {
	return { vias: points.map((location) => ({ location })) };
}

function hasAutoPending(): boolean {
	return waypoints.some(
		(_, index) => waypointAction(index) === 'move' && hasDetourCandidate(index)
	);
}

function applyReadyResult(
	result: RouteSuccess,
	revision: number,
	refined: boolean,
	preservedOverrides: Record<number, WaypointRefinementAction> = {},
	continuedLoadingAction: RouteLoadingAction = null
) {
	status = continuedLoadingAction ? 'loading' : 'ready';
	loadingAction = continuedLoadingAction;
	geometry = result.geometry;
	waypoints = result.waypoints;
	detourAnalysis = analyzeRouteDetours(result.geometry, result.waypoints);
	waypointActionOverrides = preservedOverrides;
	rebuildDetours();
	distanceM = result.distanceM;
	errorMessage = null;
	sourceRevision = revision;
	hasRefinedRoute = refined;
}

async function requestPreparedRoute(
	request: RouteRequest,
	revision: number,
	action: Exclude<RouteLoadingAction, null>,
	options: {
		preserveCurrent: boolean;
		refined: boolean;
		preservedOverrides?: Record<number, WaypointRefinementAction>;
		keepLoadingAfterSuccess?: boolean;
	}
): Promise<RouteResponse> {
	const previewVias = request.vias.map(({ location }) => location);
	const id = ++requestId;
	status = 'loading';
	loadingAction = action;
	errorMessage = null;
	sourceRevision = revision;

	if (!options.preserveCurrent) {
		// Show prepared vias immediately while the first OSRM request runs.
		waypoints = previewVias;
		geometry = null;
		detours = [];
		detourAnalysis = [];
		waypointActionOverrides = {};
		distanceM = 0;
		hasRefinedRoute = false;
	}

	const result = await requestRoute(request);
	if (id !== requestId) {
		return { ok: false, error: 'Superseded.' };
	}

	if (!result.ok) {
		loadingAction = null;
		errorMessage = result.error;
		if (options.preserveCurrent && geometry) {
			status = 'ready';
			return result;
		}

		status = 'error';
		geometry = null;
		detours = [];
		detourAnalysis = [];
		waypointActionOverrides = {};
		distanceM = 0;
		hasRefinedRoute = false;
		return result;
	}

	applyReadyResult(
		result,
		revision,
		options.refined,
		options.preservedOverrides,
		options.keepLoadingAfterSuccess ? action : null
	);
	return result;
}

type RouteSnapshot = {
	geometry: LineString;
	waypoints: Position[];
	distanceM: number;
	overrides: Record<number, WaypointRefinementAction>;
	refined: boolean;
};

function snapshotRoute(): RouteSnapshot | null {
	if (!geometry) return null;
	return {
		geometry,
		waypoints: [...waypoints],
		distanceM,
		overrides: { ...waypointActionOverrides },
		refined: hasRefinedRoute
	};
}

function restoreSnapshot(snapshot: RouteSnapshot, revision: number) {
	applyReadyResult(
		{
			ok: true,
			geometry: snapshot.geometry,
			waypoints: snapshot.waypoints,
			distanceM: snapshot.distanceM
		},
		revision,
		snapshot.refined,
		snapshot.overrides
	);
}

async function refineAutomatically(revision: number) {
	const startedAt = Date.now();
	// Local loop bookkeeping is intentionally not part of Svelte's reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const seen = new Set<string>();
	try {
		for (let iteration = 0; iteration < 5 && Date.now() - startedAt < 5_000; iteration++) {
			if (
				!canRefineCurrentResult() ||
				!hasAutoPending() ||
				Object.keys(waypointActionOverrides).length > 0
			) {
				break;
			}
			const before = snapshotRoute();
			if (!before) break;
			const beforeScore = scoreRouteDetours(detourAnalysis, distanceM);
			if (beforeScore.candidateCount === 0) break;
			const plan = refinementPlan();
			const requestHash = routeRequestHash(plan.request);
			if (seen.has(requestHash)) break;
			seen.add(requestHash);

			const result = await requestPreparedRoute(plan.request, revision, 'generate', {
				preserveCurrent: true,
				refined: true,
				// Keep one operation-level loading state across the automatic request loop.
				keepLoadingAfterSuccess: true
			});
			if (!result.ok) break;
			if (!improvesDetourScore(scoreRouteDetours(detourAnalysis, distanceM), beforeScore)) {
				restoreSnapshot(before, revision);
				break;
			}
		}
	} finally {
		if (
			status === 'loading' &&
			geometry != null &&
			sourceRevision === revision &&
			loadingAction === 'generate'
		) {
			status = 'ready';
			loadingAction = null;
		}
	}
	return geometry
		? ({ ok: true, geometry, waypoints, distanceM } satisfies RouteSuccess)
		: ({ ok: false, error: 'No route found.' } as const);
}

function waypointFeatures(points: Position[], interactive: boolean): Feature[] {
	const n = points.length;
	return points.map((coordinates, index) => ({
		type: 'Feature' as const,
		properties: {
			kind: 'waypoint',
			index,
			role: waypointRole(index, n),
			candidate: hasDetourCandidate(index),
			action: waypointAction(index),
			interactive
		},
		geometry: { type: 'Point' as const, coordinates }
	}));
}

export const route = {
	get status() {
		return status;
	},
	get geometry() {
		return geometry;
	},
	get detours() {
		return detours;
	},
	get detourCount() {
		return detours.length;
	},
	get moveWaypointCount() {
		return actionCount('move');
	},
	get removeWaypointCount() {
		return actionCount('remove');
	},
	get pendingWaypointCount() {
		return pendingWaypointCount();
	},
	get remainingWaypointCount() {
		return refinementPlan().request.vias.length;
	},
	get canRefineRoute() {
		return canRefine();
	},
	get hasRefinedRoute() {
		return hasRefinedRoute;
	},
	get loadingAction() {
		return loadingAction;
	},
	get waypoints() {
		return waypoints;
	},
	getWaypointAction(index: number) {
		return waypointAction(index);
	},
	isWaypointDetourCandidate(index: number) {
		return hasDetourCandidate(index);
	},
	get distanceM() {
		return distanceM;
	},
	get errorMessage() {
		return errorMessage;
	},
	get isLoading() {
		return status === 'loading';
	},
	get isReady() {
		return status === 'ready' && geometry != null;
	},
	/**
	 * Map source data: base route, display-only detour overlays, and via points.
	 */
	get collection(): FeatureCollection {
		const features: Feature[] = [];
		if (geometry) {
			features.push({
				type: 'Feature',
				properties: { kind: 'route' },
				geometry
			});
		}
		for (const detour of detours) {
			features.push({
				type: 'Feature',
				properties: {
					kind: 'detour',
					action: 'move',
					routeDistanceM: detour.routeDistanceM,
					returnDistanceM: detour.returnDistanceM,
					excessDistanceM: detour.excessDistanceM
				},
				geometry: detour.geometry
			});
		}
		if (waypoints.length > 0) {
			features.push(...waypointFeatures(waypoints, status === 'ready' && geometry != null));
		}
		return { type: 'FeatureCollection', features };
	},
	get distanceLabel() {
		return formatDistance(distanceM);
	},
	/** Drop route when the drawing revision no longer matches what produced it. */
	syncSketch(revision: number) {
		if (sourceRevision == null) return;
		if (revision !== sourceRevision) {
			requestId += 1; // cancel in-flight apply
			status = 'idle';
			resetResult();
		}
	},
	clear() {
		requestId += 1;
		status = 'idle';
		resetResult();
	},
	/** Advance one ready route waypoint through its available refinement actions. */
	cycleWaypointAction(index: number): WaypointRefinementAction | null {
		if (status !== 'ready' || geometry == null) return null;
		if (!Number.isInteger(index) || index < 0 || index >= waypoints.length) return null;

		const actions: WaypointRefinementAction[] = hasDetourCandidate(index)
			? ['move', 'remove', 'keep']
			: ['keep', 'remove'];
		const current = waypointAction(index);
		const next = actions[(actions.indexOf(current) + 1) % actions.length]!;
		if (next === defaultWaypointAction(index)) delete waypointActionOverrides[index];
		else waypointActionOverrides[index] = next;
		rebuildDetours();
		return next;
	},
	async refineRoute(): Promise<RouteResponse> {
		if (status !== 'ready' || geometry == null || sourceRevision == null) {
			return { ok: false, error: 'Generate a route first.' };
		}
		if (pendingWaypointCount() === 0) {
			return { ok: false, error: 'Choose at least one waypoint action to refine the route.' };
		}

		const plan = refinementPlan();
		if (plan.request.vias.length < MIN_VIAS) {
			return { ok: false, error: `Keep at least ${MIN_VIAS} waypoints to refine the route.` };
		}

		return requestPreparedRoute(plan.request, sourceRevision, 'refine', {
			preserveCurrent: true,
			refined: true,
			preservedOverrides: plan.preservedOverrides
		});
	},
	async resetFromSketch(features: Feature[], revision: number): Promise<RouteResponse> {
		if (status !== 'ready' || geometry == null || !hasRefinedRoute) {
			return { ok: false, error: 'Refine the route first.' };
		}

		const prepared = prepareRouteVias(features);
		if (!prepared.ok) {
			errorMessage = prepared.error;
			return prepared;
		}

		return requestPreparedRoute(requestFromPositions(prepared.vias), revision, 'reset', {
			preserveCurrent: true,
			refined: false
		});
	},
	async generate(features: Feature[], revision: number, options: { autoRefine?: boolean } = {}) {
		if (features.length === 0) {
			const error = 'Sketch a shape first.';
			showError(revision, error);
			return { ok: false as const, error };
		}

		const prepared = prepareRouteVias(features);
		if (!prepared.ok) {
			showError(revision, prepared.error);
			return prepared;
		}

		const result = await requestPreparedRoute(
			requestFromPositions(prepared.vias),
			revision,
			'generate',
			{
				preserveCurrent: false,
				refined: false
			}
		);
		if (!result.ok || !options.autoRefine) return result;
		return refineAutomatically(revision);
	},
	/** Download GPX for the current route (no-op when not ready). */
	downloadGpx() {
		if (!geometry) return;
		const text = lineStringToGpx(geometry);
		downloadTextFile(routeGpxFilename(), text, 'application/gpx+xml');
	}
};
