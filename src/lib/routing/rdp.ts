import { distanceBetween } from '$lib/geometry/distance';
import type { Point } from '$lib/types/sketch';

// Ramer–Douglas–Peucker polyline simplification. Drops every interior
// point whose perpendicular distance from the chord between its kept
// neighbours is below `toleranceMeters`. A long pencil stroke along a
// straight street therefore collapses to its two endpoints, while a
// point that bows sharply off the chord (an outlier the user
// intentionally placed mid-block) survives because its perpendicular
// distance is high.
//
// Iterative implementation (explicit [start, end] stack) rather than
// recursion — a 5 km pencil stroke can produce thousands of points and
// recursion would blow the call stack.
//
// `toleranceMeters` is calibrated against pencil input, which is already
// filtered to ~8 m spacing during drawing (see SketchState.handleMapMouseMove).
// At 10 m the algorithm removes mouse jitter without losing any
// intentional curve; see RDP_TOLERANCE in $lib/constants/routing.
export function simplifyRdp(points: Point[], toleranceMeters: number): Point[] {
	if (toleranceMeters <= 0) {
		throw new Error('RDP tolerance must be greater than 0.');
	}
	if (points.length < 3) return points.slice();

	const keep = new Array<boolean>(points.length).fill(false);
	keep[0] = true;
	keep[points.length - 1] = true;

	const stack: Array<[number, number]> = [[0, points.length - 1]];
	while (stack.length > 0) {
		const [start, end] = stack.pop() as [number, number];
		let maxDistance = 0;
		let maxIndex = -1;
		for (let i = start + 1; i < end; i++) {
			const d = perpendicularDistance(points[i], points[start], points[end]);
			if (d > maxDistance) {
				maxDistance = d;
				maxIndex = i;
			}
		}
		if (maxIndex !== -1 && maxDistance > toleranceMeters) {
			keep[maxIndex] = true;
			stack.push([start, maxIndex]);
			stack.push([maxIndex, end]);
		}
	}

	const simplified: Point[] = [];
	for (let i = 0; i < points.length; i++) {
		if (keep[i]) simplified.push(points[i]);
	}
	return simplified;
}

// Perpendicular distance from `p` to the chord segment [a, b], in meters.
// Clamps the projection onto the segment so points past the chord's
// endpoints still report a meaningful distance instead of sliding along
// the infinite-line projection.
function perpendicularDistance(p: Point, a: Point, b: Point): number {
	const dx = b.lng - a.lng;
	const dy = b.lat - a.lat;
	if (dx === 0 && dy === 0) {
		return distanceBetween(p, a);
	}
	const t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy);
	const tc = Math.max(0, Math.min(1, t));
	const projLng = a.lng + tc * dx;
	const projLat = a.lat + tc * dy;
	return distanceBetween(p, { lat: projLat, lng: projLng });
}
