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

export function closeShape(points: Point[]) {
	if (points.length < 2) return points;
	const first = points[0];
	const last = points.at(-1);

	if (last && first.lat === last.lat && first.lng === last.lng) return points;
	return [...points, first];
}
