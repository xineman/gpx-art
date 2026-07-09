import type { Feature, FeatureCollection } from 'geojson';
import type { Point } from '$lib/types/sketch';
import type { RouteDebugBatch } from '$lib/routing/batchPlan';
import { featureCollection, lineFeature, pointFeature } from './coords';

// Cream fill for the point markers, matching vertex handles so the debug
// overlay reads as part of the same visual vocabulary. Stroke is the batch color.
export function buildRouteDebugCollection(batches: readonly RouteDebugBatch[]): FeatureCollection {
	const features: Feature[] = [];

	for (const batch of batches) {
		if (batch.points.length === 0) continue;

		const line = lineFeature(batch.points, { color: batch.color });
		if (line) features.push(line);

		for (const point of batch.points) {
			features.push(pointFeature(point, { color: batch.color }));
		}
	}

	return featureCollection(features);
}

// Re-export helper used by tests / callers that only need point conversion.
export function toLngLatPairs(points: Point[]): [number, number][] {
	return points.map((p) => [p.lng, p.lat]);
}
