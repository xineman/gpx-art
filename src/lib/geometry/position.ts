import type { Position } from 'geojson';

/** True when two positions have exactly the same longitude and latitude. */
export function samePosition(a: Position, b: Position): boolean {
	return a[0] === b[0] && a[1] === b[1];
}

/** Exact `lng,lat` lookup key for a position. */
export function positionKey(position: Position): string {
	return `${position[0]},${position[1]}`;
}

/** True when a ring's first and last positions are the same vertex. */
export function isClosedRing(ring: Position[]): boolean {
	if (ring.length < 2) return false;
	return samePosition(ring[0]!, ring[ring.length - 1]!);
}
