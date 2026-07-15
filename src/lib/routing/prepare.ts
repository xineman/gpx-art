import type { Feature, Position } from 'geojson';
import { MAX_VIAS } from '$lib/config/routing';
import { extractGuidePaths } from './extract';
import { guideToVias } from './vias';

export type RouteLeg = {
	/** OSRM via points for one guide path. */
	vias: Position[];
	closed: boolean;
};

export type PrepareRouteLegsResult =
	| {
			ok: true;
			legs: RouteLeg[];
			/** Flat ordered vias for map markers (all legs concatenated). */
			waypoints: Position[];
	  }
	| { ok: false; error: string };

/**
 * Client-side: sketch features → OSRM via legs + flat waypoint list for the map.
 */
export function prepareRouteLegs(
	features: Feature[],
	options: { maxVias?: number } = {}
): PrepareRouteLegsResult {
	if (features.length === 0) {
		return { ok: false, error: 'Sketch a shape first.' };
	}

	const guides = extractGuidePaths(features);
	if (guides.length === 0) {
		return { ok: false, error: 'No routable shapes in the sketch.' };
	}

	const maxVias = options.maxVias ?? MAX_VIAS;
	const viaBudget =
		guides.length === 1
			? maxVias
			: Math.min(maxVias, Math.max(12, Math.floor(maxVias / guides.length)));

	const legs: RouteLeg[] = [];
	const waypoints: Position[] = [];

	for (const guide of guides) {
		const viasResult = guideToVias(guide, { maxVias: viaBudget });
		if (!viasResult.ok) {
			if (guides.length === 1) return viasResult;
			continue;
		}
		legs.push({ vias: viasResult.vias, closed: viasResult.closed });
		for (const p of viasResult.vias) {
			const prev = waypoints[waypoints.length - 1];
			if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) {
				waypoints.push(p);
			}
		}
	}

	if (legs.length === 0) {
		return { ok: false, error: 'Need a longer sketch to route.' };
	}

	return { ok: true, legs, waypoints };
}
