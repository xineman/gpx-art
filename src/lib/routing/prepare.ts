import type { Feature, Position } from 'geojson';
import { MAX_VIAS, MIN_VIAS } from '$lib/config/routing';
import { pathLength } from '$lib/geometry/distance';
import { extractGuidePaths } from './extract';
import type { GuidePath } from './types';
import { guideToVias } from './vias';

export type PrepareRouteViasResult =
	| {
			ok: true;
			vias: Position[];
	  }
	| { ok: false; error: string };

function appendUnique(target: Position[], points: Position[]) {
	for (const point of points) {
		const previous = target.at(-1);
		if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
			target.push(point);
		}
	}
}

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
 * Client-side: sketch features → one ordered OSRM via sequence.
 */
export function prepareRouteVias(
	features: Feature[],
	options: { maxVias?: number } = {}
): PrepareRouteViasResult {
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

	const vias: Position[] = [];

	for (const [index, guide] of guides.entries()) {
		const viasResult = guideToVias(guide, { maxVias: viaBudgets[index]! });
		if (!viasResult.ok) {
			return viasResult;
		}
		appendUnique(vias, viasResult.vias);
	}

	if (vias.length === 0) {
		return { ok: false, error: 'Need a longer sketch to route.' };
	}

	return { ok: true, vias };
}
