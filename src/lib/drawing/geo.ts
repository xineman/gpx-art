import type { LineString, Polygon, Position } from 'geojson';

export function lineString(points: Position[]): LineString {
	return { type: 'LineString', coordinates: points };
}

export function closedPolygon(points: Position[]): Polygon {
	const ring = [...points];
	const first = ring[0];
	const last = ring[ring.length - 1];
	if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
		ring.push(first);
	}
	return { type: 'Polygon', coordinates: [ring] };
}

/** Axis-aligned rectangle from two opposite corners (lng/lat). */
export function rectanglePolygon(a: Position, b: Position): Polygon {
	const [lng1, lat1] = a;
	const [lng2, lat2] = b;
	const ring: Position[] = [
		[lng1, lat1],
		[lng2, lat1],
		[lng2, lat2],
		[lng1, lat2],
		[lng1, lat1]
	];
	return { type: 'Polygon', coordinates: [ring] };
}

export function distanceSq(a: Position, b: Position): number {
	const dx = a[0] - b[0];
	const dy = a[1] - b[1];
	return dx * dx + dy * dy;
}

/** Drop points closer than `minDeg` (degrees) to the previous sample. */
export function shouldSample(prev: Position | undefined, next: Position, minDeg = 1e-5): boolean {
	if (!prev) return true;
	return distanceSq(prev, next) >= minDeg * minDeg;
}
