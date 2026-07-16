import type { Feature, Geometry, Position } from 'geojson';
import type { GuidePath } from './types';

function isClosedRing(ring: Position[]): boolean {
	if (ring.length < 2) return false;
	const first = ring[0];
	const last = ring[lastIndex(ring)];
	return !!first && !!last && first[0] === last[0] && first[1] === last[1];
}

function lastIndex(ring: Position[]) {
	return ring.length - 1;
}

/** Drop the repeated closing vertex of a GeoJSON polygon ring. */
export function openRing(ring: Position[]): Position[] {
	if (ring.length === 0) return [];
	if (isClosedRing(ring)) return ring.slice(0, -1);
	return [...ring];
}

function pathFromGeometry(geometry: Geometry): GuidePath | null {
	switch (geometry.type) {
		case 'LineString': {
			const points = geometry.coordinates;
			if (points.length < 2) return null;
			const closed = points.length >= 3 && isClosedRing(points);
			return {
				points: closed ? openRing(points) : [...points],
				closed
			};
		}
		case 'Polygon': {
			const ring = geometry.coordinates[0] ?? [];
			const open = openRing(ring);
			if (open.length < 3) return null;
			return { points: open, closed: true };
		}
		case 'MultiLineString': {
			// Flatten parts in order; treat as one open path (no phantom joins of distant parts).
			// Prefer the longest part for routing fidelity.
			let best: Position[] = [];
			for (const line of geometry.coordinates) {
				if (line.length > best.length) best = line;
			}
			if (best.length < 2) return null;
			return { points: [...best], closed: false };
		}
		case 'MultiPolygon': {
			const poly = geometry.coordinates[0];
			const ring = poly?.[0] ?? [];
			const open = openRing(ring);
			if (open.length < 3) return null;
			return { points: open, closed: true };
		}
		default:
			return null;
	}
}

/**
 * Extract one guide path per supported feature (draw order preserved).
 * Unsupported geometries are skipped.
 */
export function extractGuidePaths(features: Feature[]): GuidePath[] {
	const paths: GuidePath[] = [];
	for (const feature of features) {
		const path = pathFromGeometry(feature.geometry);
		if (!path) continue;
		paths.push(path);
	}
	return paths;
}
