import type { Geometry, LineString, Position } from 'geojson';

export function lineString(points: Position[]): LineString {
	return { type: 'LineString', coordinates: points };
}

/** Close a route guide by repeating its first coordinate exactly once. */
export function closedLineString(points: Position[]): LineString {
	const line = [...points];
	const first = line[0];
	const last = line[line.length - 1];
	if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
		line.push(first);
	}
	return lineString(line);
}

/** Axis-aligned rectangle from two opposite corners (lng/lat). */
export function rectangleLineString(a: Position, b: Position): LineString {
	const [lng1, lat1] = a;
	const [lng2, lat2] = b;
	return lineString([
		[lng1, lat1],
		[lng2, lat1],
		[lng2, lat2],
		[lng1, lat2],
		[lng1, lat1]
	]);
}

export function isClosedLineString(geometry: Geometry): boolean {
	if (geometry.type !== 'LineString' || geometry.coordinates.length < 3) return false;
	const first = geometry.coordinates[0];
	const last = geometry.coordinates[geometry.coordinates.length - 1];
	return !!first && !!last && first[0] === last[0] && first[1] === last[1];
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
