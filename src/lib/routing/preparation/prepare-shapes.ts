import type { Feature } from 'geojson';
import { buildTopologyGraph } from '../topology/build-graph';
import { planTopologyWalks } from '../topology/walks';
import { extractGuidePaths } from './extract';
import type { GuidePath, PreparedRouteShape } from './types';
import { allocateWalkVias } from './vias';

export type PrepareShapesResult =
	| {
			ok: true;
			shapes: PreparedRouteShape[];
	  }
	| { ok: false; error: string };

function guideKey(guide: GuidePath): string {
	return `${guide.closed ? 'closed' : 'open'}:${guide.points
		.map((point) => `${point[0]},${point[1]}`)
		.join(';')}`;
}

/**
 * Client-side: sketch features → one sampled route shape per connected component. Touching and
 * crossing features join one component whose walk covers every drawn path; component boundaries
 * are retained so the browser can optimize their order and traversal.
 */
export function prepareRouteShapes(
	features: Feature[],
	options: { maxVias?: number } = {}
): PrepareShapesResult {
	if (features.length === 0) {
		return { ok: false, error: 'Sketch a shape first.' };
	}

	// Canonical guide order keeps node ids, and so the planned walks, independent of draw order.
	const guides = extractGuidePaths(features).sort((a, b) => guideKey(a).localeCompare(guideKey(b)));
	if (guides.length === 0) {
		return { ok: false, error: 'No routable shapes in the sketch.' };
	}

	const walks = planTopologyWalks(buildTopologyGraph(guides));
	if (walks.length === 0) {
		return { ok: false, error: 'Need a longer sketch to route.' };
	}

	const allocated = allocateWalkVias(walks, { maxVias: options.maxVias });
	if (!allocated.ok) return allocated;

	return {
		ok: true,
		shapes: walks.map((walk, index) => ({ vias: allocated.vias[index]!, closed: walk.closed }))
	};
}
