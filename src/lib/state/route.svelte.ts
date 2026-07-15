import type { Feature, FeatureCollection, LineString, Position } from 'geojson';
import { downloadTextFile } from '$lib/drawing/io';
import { formatDistance } from '$lib/geometry/distance';
import { requestRoute } from '$lib/routing/client';
import { lineStringToGpx, routeGpxFilename } from '$lib/routing/gpx';
import { prepareRouteLegs } from '$lib/routing/prepare';

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';

export type WaypointRole = 'start' | 'via' | 'end';

let status = $state<RouteStatus>('idle');
let geometry = $state<LineString | null>(null);
let waypoints = $state<Position[]>([]);
let distanceM = $state(0);
let errorMessage = $state<string | null>(null);
/** Fingerprint of features used for the current/last successful or in-flight route. */
let sourceFingerprint = $state<string | null>(null);
let requestId = 0;

function fingerprint(features: Feature[]): string {
	return features
		.map((f) => {
			const id =
				typeof f.properties === 'object' &&
				f.properties &&
				typeof (f.properties as { id?: unknown }).id === 'string'
					? (f.properties as { id: string }).id
					: String(f.id ?? '');
			return id;
		})
		.join('\0');
}

function waypointRole(index: number, total: number): WaypointRole {
	if (index === 0) return 'start';
	if (index === total - 1) return 'end';
	return 'via';
}

function resetResult() {
	geometry = null;
	waypoints = [];
	distanceM = 0;
	errorMessage = null;
	sourceFingerprint = null;
}

function waypointFeatures(points: Position[]): Feature[] {
	const n = points.length;
	return points.map((coordinates, index) => ({
		type: 'Feature' as const,
		properties: {
			kind: 'waypoint',
			index,
			role: waypointRole(index, n)
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
	get waypoints() {
		return waypoints;
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
	 * Map source data: route LineString (when ready) + via Points (loading or ready).
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
		if (waypoints.length > 0) {
			features.push(...waypointFeatures(waypoints));
		}
		return { type: 'FeatureCollection', features };
	},
	get distanceLabel() {
		return formatDistance(distanceM);
	},
	/** Drop route when the sketch no longer matches what produced it. */
	syncSketch(features: Feature[]) {
		const fp = fingerprint(features);
		if (sourceFingerprint == null) return;
		if (fp !== sourceFingerprint) {
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
	async generate(features: Feature[]) {
		if (features.length === 0) {
			status = 'error';
			errorMessage = 'Sketch a shape first.';
			geometry = null;
			waypoints = [];
			distanceM = 0;
			return { ok: false as const, error: errorMessage };
		}

		const prepared = prepareRouteLegs(features);
		if (!prepared.ok) {
			status = 'error';
			errorMessage = prepared.error;
			geometry = null;
			waypoints = [];
			distanceM = 0;
			return prepared;
		}

		const id = ++requestId;
		const fp = fingerprint(features);
		status = 'loading';
		errorMessage = null;
		sourceFingerprint = fp;
		// Show vias immediately while OSRM runs.
		waypoints = prepared.waypoints;
		geometry = null;
		distanceM = 0;

		const result = await requestRoute(prepared.legs);

		// Stale response (sketch changed or a newer request started).
		if (id !== requestId) {
			return { ok: false as const, error: 'Superseded.' };
		}

		if (!result.ok) {
			status = 'error';
			errorMessage = result.error;
			geometry = null;
			// Keep waypoints so the user still sees what was attempted.
			return result;
		}

		status = 'ready';
		geometry = result.geometry;
		distanceM = result.distanceM;
		errorMessage = null;
		sourceFingerprint = fp;
		return result;
	},
	/** Download GPX for the current route (no-op when not ready). */
	downloadGpx() {
		if (!geometry) return;
		const text = lineStringToGpx(geometry);
		downloadTextFile(routeGpxFilename(), text, 'application/gpx+xml');
	}
};
