import type { Point } from '$lib/types/sketch';

export function toPoint(latlng: { lat: number; lng: number }): Point {
	return { lat: latlng.lat, lng: latlng.lng };
}

export function toLatLngs(points: Point[]): [number, number][] {
	return points.map((point) => [point.lat, point.lng]);
}

export function rectanglePoints(start: Point, end: Point): Point[] {
	return [start, { lat: start.lat, lng: end.lng }, end, { lat: end.lat, lng: start.lng }];
}

// Reposition the four corners of a rectangle when one corner is dragged. The
// opposite corner stays fixed; the two adjacent corners are updated so the
// shape remains axis-aligned in lat/lng. Corners are indexed in the same
// order `rectanglePoints` produces: 0 (top-left), 1 (top-right), 2
// (bottom-right), 3 (bottom-left). Returns the original array unchanged if
// `points.length !== 4` or the moved index is out of range.
export function resizeRectangle(points: Point[], movedIndex: number, newPoint: Point): Point[] {
	if (points.length !== 4 || movedIndex < 0 || movedIndex > 3) return points;

	const next = [...points];
	next[movedIndex] = newPoint;

	if (movedIndex === 0) {
		next[1] = { lat: newPoint.lat, lng: next[2].lng };
		next[3] = { lat: next[2].lat, lng: newPoint.lng };
	} else if (movedIndex === 1) {
		next[0] = { lat: newPoint.lat, lng: next[3].lng };
		next[2] = { lat: next[3].lat, lng: newPoint.lng };
	} else if (movedIndex === 2) {
		next[1] = { lat: next[0].lat, lng: newPoint.lng };
		next[3] = { lat: newPoint.lat, lng: next[0].lng };
	} else if (movedIndex === 3) {
		next[0] = { lat: next[1].lat, lng: newPoint.lng };
		next[2] = { lat: newPoint.lat, lng: next[1].lng };
	}

	return next;
}

export function closeShape(points: Point[]) {
	if (points.length < 2) return points;
	const first = points[0];
	const last = points.at(-1);

	if (last && first.lat === last.lat && first.lng === last.lng) return points;
	return [...points, first];
}
