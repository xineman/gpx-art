import type { Feature, FeatureCollection, LineString, Position } from 'geojson';
import { AUTO_REFINE_TIMEOUT_MS, MIN_VIAS } from '$lib/config/routing';
import { downloadTextFile } from '$lib/drawing/io';
import { formatDistance } from '$lib/geometry/distance';
import { requestOptimizedRoute, requestRoute } from '$lib/routing/client';
import {
	analyzeRouteDetours,
	mergeRouteDetourCandidates,
	type RouteDetour,
	type WaypointDetourAnalysis
} from '$lib/routing/detours';
import { lineStringToGpx, routeGpxFilename } from '$lib/routing/gpx';
import { featuresToRouteShapes } from '$lib/routing/features-to-route-shapes';
import {
	buildRefinementPlan,
	defaultWaypointRefinementAction,
	getWaypointRefinementAction,
	improvesDetourScore,
	routeRequestHash,
	scoreRouteDetours,
	type RefinementPlan,
	type WaypointRefinementAction
} from '$lib/routing/refinement';
import type { RouteResponse, RouteSuccess } from '$lib/routing/types';

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';
export type RouteLoadingAction = 'generate' | 'refine' | 'reset' | null;

type WaypointRole = 'start' | 'via' | 'end';

let status = $state<RouteStatus>('idle');
let loadingAction = $state<RouteLoadingAction>(null);
let requestId = 0;

let geometry = $state<LineString | null>(null);
/** Prepared OSRM input while loading; OSRM-snapped positions once ready. */
let waypoints = $state<Position[]>([]);
let distanceM = $state(0);
let hasRefinedRoute = $state(false);

let detourAnalysis = $state<WaypointDetourAnalysis[]>([]);
let waypointActionOverrides = $state<Record<number, WaypointRefinementAction>>({});
/** Drawing revision used for the current/last route attempt. */
let sourceRevision = $state<number | null>(null);

function detourCandidate(index: number): RouteDetour | null {
	return detourAnalysis[index]?.candidate ?? null;
}

function hasDetourCandidate(index: number): boolean {
	return detourCandidate(index) != null;
}

function waypointAction(index: number): WaypointRefinementAction {
	return getWaypointRefinementAction(detourCandidate(index), waypointActionOverrides[index]);
}

const waypointActionCounts = $derived.by(() => {
	let move = 0;
	let remove = 0;

	for (let index = 0; index < waypoints.length; index++) {
		const action = waypointAction(index);
		if (action === 'move') move += 1;
		if (action === 'remove') remove += 1;
	}

	return { move, remove, pending: move + remove };
});

const refinementPlan: RefinementPlan = $derived.by(() =>
	buildRefinementPlan(geometry, waypoints, detourAnalysis, waypointActionOverrides)
);

const detours: RouteDetour[] = $derived.by(() => {
	if (!geometry) return [];

	const candidates = detourAnalysis.flatMap(({ waypointIndex, candidate }) =>
		waypointAction(waypointIndex) === 'move' && candidate ? [candidate] : []
	);
	return mergeRouteDetourCandidates(geometry, candidates);
});

const canRefineCurrentResult = $derived(
	geometry != null &&
		waypointActionCounts.pending > 0 &&
		refinementPlan.request.vias.length >= MIN_VIAS
);

const canRefineRoute = $derived(status === 'ready' && canRefineCurrentResult);

function resetRoute(
	nextStatus: RouteStatus,
	revision: number | null = null,
	options: { preserveWaypoints?: boolean } = {}
) {
	status = nextStatus;
	geometry = null;
	detourAnalysis = [];
	waypointActionOverrides = {};
	if (!options.preserveWaypoints) waypoints = [];
	distanceM = 0;
	sourceRevision = revision;
	loadingAction = null;
	hasRefinedRoute = false;
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
	distanceM = result.distanceM;
	sourceRevision = revision;
	hasRefinedRoute = refined;
}

async function runPreparedRouteRequest(
	request: () => Promise<RouteResponse>,
	previewVias: Position[],
	revision: number,
	action: Exclude<RouteLoadingAction, null>,
	options: {
		preserveCurrent: boolean;
		refined: boolean;
		preservedOverrides?: Record<number, WaypointRefinementAction>;
		keepLoadingAfterSuccess?: boolean;
	}
): Promise<RouteResponse> {
	const id = ++requestId;
	status = 'loading';
	loadingAction = action;
	sourceRevision = revision;

	if (!options.preserveCurrent) {
		// Show ordered vias immediately when the operation already knows their roles.
		waypoints = previewVias;
		geometry = null;
		detourAnalysis = [];
		waypointActionOverrides = {};
		distanceM = 0;
		hasRefinedRoute = false;
	}

	const result = await request();
	if (id !== requestId) {
		return { ok: false, error: 'Superseded.' };
	}

	if (!result.ok) {
		if (options.preserveCurrent && geometry) {
			loadingAction = null;
			status = 'ready';
			return result;
		}

		resetRoute('error', revision, { preserveWaypoints: true });
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

function hasAutoPending(): boolean {
	return detourAnalysis.some(({ candidate }) => candidate != null);
}

async function refineAutomatically(revision: number) {
	const startedAt = Date.now();
	// Local loop bookkeeping is intentionally not part of Svelte's reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const seen = new Set<string>();
	try {
		while (Date.now() - startedAt < AUTO_REFINE_TIMEOUT_MS) {
			if (
				!canRefineCurrentResult ||
				!hasAutoPending() ||
				Object.keys(waypointActionOverrides).length > 0
			) {
				break;
			}
			const before = snapshotRoute();
			if (!before) break;
			const beforeScore = scoreRouteDetours(detourAnalysis, distanceM);
			if (beforeScore.candidateCount === 0) break;
			const requestHash = routeRequestHash(refinementPlan.request);
			if (seen.has(requestHash)) break;
			seen.add(requestHash);

			const request = refinementPlan.request;
			const result = await runPreparedRouteRequest(
				() => requestRoute(request),
				request.vias.map(({ location }) => location),
				revision,
				'generate',
				{
					preserveCurrent: true,
					refined: true,
					// Keep one operation-level loading state across the automatic request loop.
					keepLoadingAfterSuccess: true
				}
			);
			if (!result.ok) return result;
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

function waypointRole(index: number, total: number): WaypointRole {
	if (index === 0) return 'start';
	if (index === total - 1) return 'end';
	return 'via';
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

const collection: FeatureCollection = $derived.by(() => {
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
});

export const route = {
	get status() {
		return status;
	},
	get loadingAction() {
		return loadingAction;
	},
	get isLoading() {
		return status === 'loading';
	},
	get isReady() {
		return status === 'ready' && geometry != null;
	},
	get hasRefinedRoute() {
		return hasRefinedRoute;
	},
	get moveWaypointCount() {
		return waypointActionCounts.move;
	},
	get removeWaypointCount() {
		return waypointActionCounts.remove;
	},
	get pendingWaypointCount() {
		return waypointActionCounts.pending;
	},
	get canRefineRoute() {
		return canRefineRoute;
	},
	/**
	 * Map source data: base route, display-only detour overlays, and via points.
	 */
	get collection(): FeatureCollection {
		return collection;
	},
	get distanceLabel() {
		return formatDistance(distanceM);
	},
	async generate(features: Feature[], revision: number, options: { autoRefine?: boolean } = {}) {
		if (features.length === 0) {
			const error = 'Sketch a shape first.';
			resetRoute('error', revision);
			return { ok: false as const, error };
		}

		const prepared = featuresToRouteShapes(features);
		if (!prepared.ok) {
			resetRoute('error', revision);
			return prepared;
		}

		const result = await runPreparedRouteRequest(
			() => requestOptimizedRoute(prepared.shapes),
			[],
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
	async refineRoute(): Promise<RouteResponse> {
		if (status !== 'ready' || geometry == null || sourceRevision == null) {
			return { ok: false, error: 'Generate a route first.' };
		}
		if (waypointActionCounts.pending === 0) {
			return { ok: false, error: 'Choose at least one waypoint action to refine the route.' };
		}

		const plan = refinementPlan;
		if (plan.request.vias.length < MIN_VIAS) {
			return { ok: false, error: `Keep at least ${MIN_VIAS} waypoints to refine the route.` };
		}

		return runPreparedRouteRequest(
			() => requestRoute(plan.request),
			plan.request.vias.map(({ location }) => location),
			sourceRevision,
			'refine',
			{
				preserveCurrent: true,
				refined: true,
				preservedOverrides: plan.preservedOverrides
			}
		);
	},
	async resetFromSketch(features: Feature[], revision: number): Promise<RouteResponse> {
		if (status !== 'ready' || geometry == null || !hasRefinedRoute) {
			return { ok: false, error: 'Refine the route first.' };
		}

		const prepared = featuresToRouteShapes(features);
		if (!prepared.ok) {
			return prepared;
		}

		return runPreparedRouteRequest(
			() => requestOptimizedRoute(prepared.shapes),
			[],
			revision,
			'reset',
			{
				preserveCurrent: true,
				refined: false
			}
		);
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
		if (next === defaultWaypointRefinementAction(detourCandidate(index))) {
			delete waypointActionOverrides[index];
		} else waypointActionOverrides[index] = next;
		return next;
	},
	/** Drop route when the drawing revision no longer matches what produced it. */
	syncSketch(revision: number) {
		if (sourceRevision == null) return;
		if (revision !== sourceRevision) {
			requestId += 1; // cancel in-flight apply
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
