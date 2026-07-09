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

// Initial bearing from `from` → `to` in degrees clockwise from true north [0, 360).
export function initialBearingDegrees(from: Point, to: Point): number {
	const φ1 = toRadians(from.lat);
	const φ2 = toRadians(to.lat);
	const Δλ = toRadians(to.lng - from.lng);
	const y = Math.sin(Δλ) * Math.cos(φ2);
	const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
	const θ = (Math.atan2(y, x) * 180) / Math.PI;
	return (θ + 360) % 360;
}

// Cosine of the turn at `mid` when traveling a → mid → b.
// 1 = straight, 0 = 90° turn, -1 = U-turn. Degenerate segments return 1.
export function turnCosine(a: Point, mid: Point, b: Point): number {
	// Equirectangular local meters around mid (fine for turn tests < few km).
	const cosLat = Math.cos(toRadians(mid.lat));
	const mPerDegLat = 111_320;
	const mPerDegLng = 111_320 * cosLat;
	const inX = (mid.lng - a.lng) * mPerDegLng;
	const inY = (mid.lat - a.lat) * mPerDegLat;
	const outX = (b.lng - mid.lng) * mPerDegLng;
	const outY = (b.lat - mid.lat) * mPerDegLat;
	const len1 = Math.hypot(inX, inY);
	const len2 = Math.hypot(outX, outY);
	if (len1 < 1e-6 || len2 < 1e-6) return 1;
	return (inX * outX + inY * outY) / (len1 * len2);
}
