import type { Geometry, LineString, Position } from 'geojson';
import { isClosedRing } from '#lib/geometry/position.js';

export function lineString(points: Position[]): LineString {
	return { type: 'LineString', coordinates: points };
}

/** Close a route guide by repeating its first coordinate exactly once. */
export function closedLineString(points: Position[]): LineString {
	const line = [...points];
	if (line.length > 0 && !isClosedRing(line)) line.push(line[0]!);
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
	return (
		geometry.type === 'LineString' &&
		geometry.coordinates.length >= 3 &&
		isClosedRing(geometry.coordinates)
	);
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
