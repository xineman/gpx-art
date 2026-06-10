import type { Point } from '$lib/types/sketch';

const EARTH_RADIUS_M = 6371000;

export function toRadians(degrees: number) {
	return (degrees * Math.PI) / 180;
}

export function distanceBetween(a: Point, b: Point) {
	const lat1 = toRadians(a.lat);
	const lat2 = toRadians(b.lat);
	const deltaLat = toRadians(b.lat - a.lat);
	const deltaLng = toRadians(b.lng - a.lng);
	const h =
		Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

	return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function totalDistance(points: Point[]) {
	return points.reduce((distance, point, index) => {
		if (index === 0) return distance;
		return distance + distanceBetween(points[index - 1], point);
	}, 0);
}

export function formatDistance(meters: number) {
	if (meters < 1000) return `${Math.round(meters)} m`;
	return `${(meters / 1000).toFixed(1)} km`;
}
