import type { Feature, Position } from 'geojson';
import { MAX_VIAS, MIN_VIAS } from '$lib/config/routing';
import { pathLength } from '$lib/geometry/distance';
import { extractGuidePaths } from './extract';
import type { GuidePath } from './types';
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

function minimumVias(guide: GuidePath): number {
	return guide.closed ? MIN_VIAS + 1 : MIN_VIAS;
}

/**
 * Distribute a single OSRM request's via budget across all guides. Every guide
 * receives enough points to remain routable; remaining capacity follows length.
 */
function allocateViaBudgets(guides: GuidePath[], maxVias: number): number[] | null {
	const budgets = guides.map(minimumVias);
	const minimumTotal = budgets.reduce((total, budget) => total + budget, 0);
	if (minimumTotal > maxVias) return null;

	const remaining = maxVias - minimumTotal;
	if (remaining === 0) return budgets;

	const lengths = guides.map((guide) => pathLength(guide.points));
	const totalLength = lengths.reduce((total, length) => total + length, 0);
	const weights =
		totalLength > 0
			? lengths.map((length) => length / totalLength)
			: guides.map(() => 1 / guides.length);
	const shares = weights.map((weight) => weight * remaining);
	let allocated = 0;
	for (let index = 0; index < budgets.length; index++) {
		const extra = Math.floor(shares[index]!);
		budgets[index]! += extra;
		allocated += extra;
	}

	const byRemainder = shares
		.map((share, index) => ({ index, remainder: share - Math.floor(share) }))
		.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
	for (let index = 0; index < remaining - allocated; index++) {
		budgets[byRemainder[index]!.index]! += 1;
	}

	return budgets;
}

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
	const viaBudgets = allocateViaBudgets(guides, maxVias);
	if (!viaBudgets) {
		return { ok: false, error: `Too many shapes to route at once (max ${maxVias} waypoints).` };
	}

	const legs: RouteLeg[] = [];
	const waypoints: Position[] = [];

	for (const [index, guide] of guides.entries()) {
		const viasResult = guideToVias(guide, { maxVias: viaBudgets[index]! });
		if (!viasResult.ok) {
			return viasResult;
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
