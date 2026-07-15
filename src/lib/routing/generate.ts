import type { Feature, Position } from 'geojson';
import { MAX_VIAS } from '$lib/config/routing';
import { extractGuidePaths } from './extract';
import { fetchOsrmRoute, type OsrmConfig } from './osrm';
import {
	ensureClosedLoop,
	measureRouteDistanceM,
	stitchCoordinates,
	toLineString
} from './postprocess';
import type { RouteResponse } from './types';
import { guideToVias } from './vias';

export type GenerateRouteOptions = {
	osrm: OsrmConfig;
	maxVias?: number;
};

/**
 * Full pipeline: features → vias → OSRM Route (per guide) → stitch → LineString.
 */
export async function generateRouteFromFeatures(
	features: Feature[],
	options: GenerateRouteOptions
): Promise<RouteResponse> {
	if (features.length === 0) {
		return { ok: false, error: 'Sketch a shape first.' };
	}

	const guides = extractGuidePaths(features);
	if (guides.length === 0) {
		return { ok: false, error: 'No routable shapes in the sketch.' };
	}

	const maxVias = options.maxVias ?? MAX_VIAS;
	// Full via budget for a single shape; split budget when multi-feature (sequential OSRM calls).
	const viaBudget =
		guides.length === 1
			? maxVias
			: Math.min(maxVias, Math.max(12, Math.floor(maxVias / guides.length)));

	const parts: Position[][] = [];
	let totalDistance = 0;
	let viaCount = 0;
	let anyClosed = false;

	for (const guide of guides) {
		const viasResult = guideToVias(guide, { maxVias: viaBudget });
		if (!viasResult.ok) {
			// Skip tiny fragments when multi-feature; fail hard for single.
			if (guides.length === 1) return viasResult;
			continue;
		}

		viaCount += viasResult.vias.length;
		anyClosed = anyClosed || viasResult.closed;

		const osrm = await fetchOsrmRoute(viasResult.vias, options.osrm);
		if (!osrm.ok) {
			if (guides.length === 1) return osrm;
			// Multi: skip failed segment
			continue;
		}

		let coords = osrm.geometry.coordinates;
		coords = ensureClosedLoop(coords, viasResult.closed);
		parts.push(coords);
		totalDistance += measureRouteDistanceM(coords, osrm.distanceM);
	}

	if (parts.length === 0) {
		return { ok: false, error: 'Couldn’t build a route from that sketch.' };
	}

	// Multi-feature: don't force a global close unless every guide was a single closed shape.
	const closed = guides.length === 1 && anyClosed;
	const stitched = ensureClosedLoop(stitchCoordinates(parts), closed);
	const geometry = toLineString(stitched);

	if (geometry.coordinates.length < 2) {
		return { ok: false, error: 'Couldn’t build a route from that sketch.' };
	}

	return {
		ok: true,
		geometry,
		distanceM: measureRouteDistanceM(geometry.coordinates, totalDistance),
		provider: 'osrm-route',
		viaCount
	};
}
