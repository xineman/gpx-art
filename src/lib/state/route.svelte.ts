import type { Feature, FeatureCollection, LineString } from 'geojson';
import { formatDistance } from '$lib/geometry/distance';
import { requestRoute } from '$lib/routing/client';
import { lineStringToGpx, routeGpxFilename } from '$lib/routing/gpx';
import { downloadTextFile } from '$lib/drawing/io';

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';

let status = $state<RouteStatus>('idle');
let geometry = $state<LineString | null>(null);
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

function resetResult() {
	geometry = null;
	distanceM = 0;
	errorMessage = null;
	sourceFingerprint = null;
}

export const route = {
	get status() {
		return status;
	},
	get geometry() {
		return geometry;
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
	get collection(): FeatureCollection {
		if (!geometry) {
			return { type: 'FeatureCollection', features: [] };
		}
		return {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: { kind: 'route' },
					geometry
				}
			]
		};
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
			distanceM = 0;
			return { ok: false as const, error: errorMessage };
		}

		const id = ++requestId;
		const fp = fingerprint(features);
		status = 'loading';
		errorMessage = null;
		sourceFingerprint = fp;

		const result = await requestRoute(features);

		// Stale response (sketch changed or a newer request started).
		if (id !== requestId) {
			return { ok: false as const, error: 'Superseded.' };
		}

		if (!result.ok) {
			status = 'error';
			errorMessage = result.error;
			geometry = null;
			distanceM = 0;
			// Keep fingerprint so a sketch change still clears the error state cleanly.
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
