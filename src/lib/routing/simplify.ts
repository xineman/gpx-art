import { distanceBetween } from '$lib/geometry/distance';
import type { Point } from '$lib/types/sketch';

// Ramer–Douglas–Peucker polyline simplification.
//
// Drops vertices that fall within `toleranceMeters` of the chord between two
// kept neighbours, using the existing Haversine `distanceBetween` (great-circle
// meters) for the metric. Designed to run *before* handing a hand-drawn shape
// to OSRM `/route` so the route engine has fewer hard via waypoints and more
// freedom to use natural streets between them.
//
// Iterative (explicit stack), not recursive — a 500-point scribble would
// otherwise be a stack-fragility risk and TS doesn't tail-call-optimise.
//
// Endpoints are always kept (RDP invariant): indices 0 and N-1 of the input
// appear at 0 and N-1 of the output. This is what makes the per-shape cluster
// cost matrix and the inter-shape transition routes stable across the
// simplification pass — they read shape.first and shape.last, and those don't
// move.

export function simplifyRdp(points: Point[], toleranceMeters: number): Point[] {
	const n = points.length;
	if (n < 3) return points.slice();

	// keep[i] === true if vertex i is retained in the output.
	const keep = new Array<boolean>(n).fill(false);
	keep[0] = true;
	keep[n - 1] = true;

	// Stack of [start, end] index ranges to process. Each is inclusive at
	// both ends, and both endpoints are already marked kept.
	const stack: Array<[number, number]> = [[0, n - 1]];

	while (stack.length > 0) {
		const [start, end] = stack.pop()!;

		// Find the vertex in (start, end) with the maximum perpendicular
		// distance from the chord points[start] → points[end].
		let farthestIndex = -1;
		let farthestDistance = 0;
		for (let i = start + 1; i < end; i++) {
			const d = distanceToSegment(points[i], points[start], points[end]);
			if (d > farthestDistance) {
				farthestDistance = d;
				farthestIndex = i;
			}
		}

		if (farthestIndex !== -1 && farthestDistance > toleranceMeters) {
			keep[farthestIndex] = true;
			// Recurse on both halves. Push the larger half first so the
			// smaller is processed next — keeps the stack tight. Doesn't
			// matter functionally, just keeps memory usage predictable.
			const leftSize = farthestIndex - start;
			const rightSize = end - farthestIndex;
			if (leftSize >= rightSize) {
				stack.push([start, farthestIndex]);
				stack.push([farthestIndex, end]);
			} else {
				stack.push([farthestIndex, end]);
				stack.push([start, farthestIndex]);
			}
		}
	}

	const result: Point[] = [];
	for (let i = 0; i < n; i++) {
		if (keep[i]) result.push(points[i]);
	}
	return result;
}

// Perpendicular distance from point p to the great-circle segment a→b on a
// sphere. For short waypoint segments (kilometres, not thousands of km) the
// Haversine along the chord is a good enough metric; we don't need the
// cross-track-distance formula. Falls back to point-to-point distance when the
// segment is degenerate (a === b), which happens on closed loops and on
// already-collinear inputs.
function distanceToSegment(p: Point, a: Point, b: Point): number {
	// Project p onto the chord ab using a planar approximation in
	// lat/lng-space, then measure the Haversine distance from p to that
	// projection. Good enough for ≤-few-km segments where one degree of
	// latitude is ~111 km and the curvature is negligible.
	const ax = a.lng;
	const ay = a.lat;
	const bx = b.lng;
	const by = b.lat;
	const dx = bx - ax;
	const dy = by - ay;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return distanceBetween(p, a);

	const t = Math.max(0, Math.min(1, ((p.lng - ax) * dx + (p.lat - ay) * dy) / lenSq));
	const projection: Point = { lat: ay + t * dy, lng: ax + t * dx };
	return distanceBetween(p, projection);
}
