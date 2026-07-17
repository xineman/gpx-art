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

let status = $state<RouteStatus>('idle');
let geometry = $state<LineString | null>(null);
let detours = $state<RouteDetour[]>([]);
let detourAnalysis = $state<WaypointDetourAnalysis[]>([]);
let detourOverrides = $state<Record<number, boolean>>({});
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
	detourOverrides = {};
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
	detourOverrides = {};
	waypoints = [];
	distanceM = 0;
	errorMessage = message;
	sourceRevision = revision;
	loadingAction = null;
	hasRefinedRoute = false;
}

function isEffectiveDetourWaypoint(index: number): boolean {
	const analysis = detourAnalysis[index];
	if (!analysis) return false;
	return detourOverrides[index] ?? analysis.candidate != null;
}

function selectedDetourCandidate(index: number): RouteDetour | null {
	const analysis = detourAnalysis[index];
	if (!analysis || !isEffectiveDetourWaypoint(index)) return null;
	return analysis.candidate;
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

function markedWaypointIndexes(): number[] {
	return detourAnalysis
		.filter((analysis) => isEffectiveDetourWaypoint(analysis.waypointIndex))
		.map((analysis) => analysis.waypointIndex);
}

function refinementWaypoints(): Position[] {
	if (!geometry) return dedupeConsecutivePositions(waypoints);

	const routePoints = geometry.coordinates;
	return dedupeConsecutivePositions(
		waypoints.flatMap((waypoint, index) => {
			const candidate = selectedDetourCandidate(index);
			if (!candidate) return [waypoint];

			const routeIndex = index === 0 ? candidate.endIndex : candidate.startIndex;
			return [routePoints[routeIndex] ?? waypoint];
		})
	);
}

function applyReadyResult(result: RouteSuccess, revision: number, refined: boolean) {
	status = 'ready';
	loadingAction = null;
	geometry = result.geometry;
	waypoints = result.waypoints;
	detourAnalysis = analyzeRouteDetours(result.geometry, result.waypoints);
	detourOverrides = {};
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
	options: { preserveCurrent: boolean; refined: boolean }
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
		detourOverrides = {};
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
		detourOverrides = {};
		distanceM = 0;
		hasRefinedRoute = false;
		return result;
	}

	applyReadyResult(result, revision, options.refined);
	return result;
}

function waypointFeatures(
	points: Position[],
	detourWaypointIndexes: number[],
	interactive: boolean
): Feature[] {
	const n = points.length;
	return points.map((coordinates, index) => ({
		type: 'Feature' as const,
		properties: {
			kind: 'waypoint',
			index,
			role: waypointRole(index, n),
			detour: detourWaypointIndexes.includes(index),
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
	get markedWaypointCount() {
		return markedWaypointIndexes().length;
	},
	get remainingWaypointCount() {
		return refinementWaypoints().length;
	},
	get canRefineRoute() {
		return (
			status === 'ready' &&
			geometry != null &&
			markedWaypointIndexes().length > 0 &&
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
	isWaypointDetour(index: number) {
		return isEffectiveDetourWaypoint(index);
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
		const detourWaypointIndexes = markedWaypointIndexes();
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
					routeDistanceM: detour.routeDistanceM,
					returnDistanceM: detour.returnDistanceM,
					excessDistanceM: detour.excessDistanceM
				},
				geometry: detour.geometry
			});
		}
		if (waypoints.length > 0) {
			features.push(
				...waypointFeatures(
					waypoints,
					detourWaypointIndexes,
					status === 'ready' && geometry != null
				)
			);
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
	/** Toggle one ready route waypoint's display-only detour classification. */
	toggleDetourWaypoint(index: number): 'added' | 'removed' | null {
		if (status !== 'ready' || geometry == null) return null;
		const analysis = detourAnalysis[index];
		if (!analysis?.candidate) return null;

		const next = !isEffectiveDetourWaypoint(index);
		if (next) delete detourOverrides[index];
		else detourOverrides[index] = false;
		rebuildDetours();
		return next ? 'added' : 'removed';
	},
	async refineRoute(): Promise<RouteResponse> {
		if (status !== 'ready' || geometry == null || sourceRevision == null) {
			return { ok: false, error: 'Generate a route first.' };
		}
		if (markedWaypointIndexes().length === 0) {
			return { ok: false, error: 'Mark at least one waypoint to refine the route.' };
		}

		const vias = refinementWaypoints();
		if (vias.length < MIN_VIAS) {
			return { ok: false, error: `Keep at least ${MIN_VIAS} waypoints to refine the route.` };
		}

		return requestPreparedRoute(vias, sourceRevision, 'refine', {
			preserveCurrent: true,
			refined: true
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
