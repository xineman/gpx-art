import type { Position } from 'geojson';

const EARTH_RADIUS_M = 6_371_000;

export function toRadians(degrees: number) {
	return (degrees * Math.PI) / 180;
}

/** Haversine distance in meters between two GeoJSON positions `[lng, lat]`. */
export function distanceBetween(a: Position, b: Position) {
	const [lng1, lat1] = a;
	const [lng2, lat2] = b;
	const φ1 = toRadians(lat1);
	const φ2 = toRadians(lat2);
	const Δφ = toRadians(lat2 - lat1);
	const Δλ = toRadians(lng2 - lng1);
	const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

	return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Path length along consecutive positions (meters). */
export function pathLength(points: Position[]) {
	let meters = 0;
	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const next = points[i];
		if (prev && next) meters += distanceBetween(prev, next);
	}
	return meters;
}

export function formatDistance(meters: number) {
	if (meters < 1000) return `${Math.round(meters)} m`;
	return `${(meters / 1000).toFixed(1)} km`;
}
