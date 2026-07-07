import { distanceBetween } from '$lib/geometry/distance';
import { MATCH_SAMPLE_SPACING_METERS } from '$lib/constants/routing';
import type { Point } from '$lib/types/sketch';

// Convert a sketch polyline into a GPS-like trace for OSRM /match. Original
// vertices stay in the output, and long segments get interpolated points so
// sparse shapes such as rectangles still provide enough soft guidance.
export function sampleTrace(
	points: Point[],
	spacingMeters: number = MATCH_SAMPLE_SPACING_METERS
): Point[] {
	if (points.length < 2) return points.slice();
	if (spacingMeters <= 0) {
		throw new Error('Trace sample spacing must be greater than 0.');
	}

	const sampled: Point[] = [points[0]];
	for (let i = 1; i < points.length; i++) {
		const start = points[i - 1];
		const end = points[i];
		const distance = distanceBetween(start, end);
		const segmentCount = Math.max(1, Math.ceil(distance / spacingMeters));

		for (let step = 1; step <= segmentCount; step++) {
			sampled.push(interpolatePoint(start, end, step / segmentCount));
		}
	}

	return sampled;
}

function interpolatePoint(start: Point, end: Point, t: number): Point {
	return {
		lat: start.lat + (end.lat - start.lat) * t,
		lng: start.lng + (end.lng - start.lng) * t
	};
}
