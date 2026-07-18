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
import type { RouteResponse, RouteSuccess } from '$lib/routing/types';

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';
export type RouteLoadingAction = 'generate' | 'refine' | 'reset' | null;

export type WaypointRole = 'start' | 'via' | 'end';
export type WaypointRefinementAction = 'keep' | 'move' | 'remove';

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
	return detourAnalysis[index]?.candidate != null;
}

function defaultWaypointAction(index: number): WaypointRefinementAction {
	return hasDetourCandidate(index) ? 'move' : 'keep';
}

function waypointAction(index: number): WaypointRefinementAction {
	return waypointActionOverrides[index] ?? defaultWaypointAction(index);
}

function actionCount(action: Exclude<WaypointRefinementAction, 'keep'>): number {
	return waypoints.filter((_, index) => waypointAction(index) === action).length;
}

function pendingWaypointCount(): number {
	return actionCount('move') + actionCount('remove');
}

function selectedDetourCandidate(index: number): RouteDetour | null {
	if (waypointAction(index) !== 'move') return null;
	return detourAnalysis[index]?.candidate ?? null;
}

function rebuildDetours() {
	if (!geometry) {
		detours = [];
		return;
	}

	const candidates = detourAnalysis.flatMap((analysis) => {
		const candidate = selectedDetourCandidate(analysis.waypointIndex);
		return candidate ? [candidate] : [];
	});
	detours = mergeRouteDetourCandidates(geometry, candidates);
}

function dedupeConsecutivePositions(points: Position[]): Position[] {
	const distinct: Position[] = [];
	for (const point of points) {
		const previous = distinct.at(-1);
		if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
			distinct.push(point);
		}
	}
	return distinct;
}

function refinementWaypoints(): Position[] {
	if (!geometry) return dedupeConsecutivePositions(waypoints);

	const routePoints = geometry.coordinates;
	return dedupeConsecutivePositions(
		waypoints.flatMap((waypoint, index) => {
			const action = waypointAction(index);
			if (action === 'remove') return [];
			if (action === 'keep') return [waypoint];

			const candidate = selectedDetourCandidate(index);
			if (!candidate) return [waypoint];

			const routeIndex = index === 0 ? candidate.endIndex : candidate.startIndex;
			return [routePoints[routeIndex] ?? waypoint];
		})
	);
}

/**
 * A user can explicitly keep a waypoint that detour analysis suggested moving.
 * Preserve that choice when its waypoint survives a refinement request, so a
 * newly detected detour does not immediately turn it back into a move action.
 */
function refinementOverrides(): Record<number, WaypointRefinementAction> {
	const overrides: Record<number, WaypointRefinementAction> = {};
	let refinedIndex = 0;

	for (let index = 0; index < waypoints.length; index++) {
		if (waypointAction(index) === 'remove') continue;
		if (waypointActionOverrides[index] === 'keep') overrides[refinedIndex] = 'keep';
		refinedIndex += 1;
	}

	return overrides;
}

function applyReadyResult(
	result: RouteSuccess,
	revision: number,
	refined: boolean,
	preservedOverrides: Record<number, WaypointRefinementAction> = {}
) {
	status = 'ready';
	loadingAction = null;
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
	vias: Position[],
	revision: number,
	action: Exclude<RouteLoadingAction, null>,
	options: {
		preserveCurrent: boolean;
		refined: boolean;
		preservedOverrides?: Record<number, WaypointRefinementAction>;
	}
): Promise<RouteResponse> {
	const id = ++requestId;
	status = 'loading';
	loadingAction = action;
	errorMessage = null;
	sourceRevision = revision;

	if (!options.preserveCurrent) {
		// Show prepared vias immediately while the first OSRM request runs.
		waypoints = vias;
		geometry = null;
		detours = [];
		detourAnalysis = [];
		waypointActionOverrides = {};
		distanceM = 0;
		hasRefinedRoute = false;
	}

	const result = await requestRoute(vias);
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

	applyReadyResult(result, revision, options.refined, options.preservedOverrides);
	return result;
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
		return refinementWaypoints().length;
	},
	get canRefineRoute() {
		return (
			status === 'ready' &&
			geometry != null &&
			pendingWaypointCount() > 0 &&
			refinementWaypoints().length >= MIN_VIAS
		);
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

		const vias = refinementWaypoints();
		const preservedOverrides = refinementOverrides();
		if (vias.length < MIN_VIAS) {
			return { ok: false, error: `Keep at least ${MIN_VIAS} waypoints to refine the route.` };
		}

		return requestPreparedRoute(vias, sourceRevision, 'refine', {
			preserveCurrent: true,
			refined: true,
			preservedOverrides
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

		return requestPreparedRoute(prepared.vias, revision, 'reset', {
			preserveCurrent: true,
			refined: false
		});
	},
	async generate(features: Feature[], revision: number) {
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

		return requestPreparedRoute(prepared.vias, revision, 'generate', {
			preserveCurrent: false,
			refined: false
		});
	},
	/** Download GPX for the current route (no-op when not ready). */
	downloadGpx() {
		if (!geometry) return;
		const text = lineStringToGpx(geometry);
		downloadTextFile(routeGpxFilename(), text, 'application/gpx+xml');
	}
};
