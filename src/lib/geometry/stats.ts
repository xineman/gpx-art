import type { Feature, Geometry, Position } from 'geojson';
import { formatDistance, pathLength } from './distance';

/** True when the ring's first and last positions are the same vertex. */
function isClosedRing(ring: Position[]) {
	if (ring.length < 2) return false;
	const first = ring[0];
	const last = ring[ring.length - 1];
	return !!first && !!last && first[0] === last[0] && first[1] === last[1];
}

/**
 * Sketch vertex count for a geometry.
 * Closed polygon rings count unique corners (drop the repeated close vertex).
 */
export function geometryPointCount(geometry: Geometry): number {
	switch (geometry.type) {
		case 'Point':
			return 1;
		case 'MultiPoint':
			return geometry.coordinates.length;
		case 'LineString':
			return geometry.coordinates.length;
		case 'MultiLineString':
			return geometry.coordinates.reduce((n, line) => n + line.length, 0);
		case 'Polygon': {
			const ring = geometry.coordinates[0] ?? [];
			return isClosedRing(ring) ? Math.max(0, ring.length - 1) : ring.length;
		}
		case 'MultiPolygon':
			return geometry.coordinates.reduce((n, poly) => {
				const ring = poly[0] ?? [];
				return n + (isClosedRing(ring) ? Math.max(0, ring.length - 1) : ring.length);
			}, 0);
		case 'GeometryCollection':
			return geometry.geometries.reduce((n, g) => n + geometryPointCount(g), 0);
		default:
			return 0;
	}
}

/** Path length in meters for one geometry (no cross-part phantom segments). */
export function geometryLength(geometry: Geometry): number {
	switch (geometry.type) {
		case 'Point':
		case 'MultiPoint':
			return 0;
		case 'LineString':
			return pathLength(geometry.coordinates);
		case 'MultiLineString':
			return geometry.coordinates.reduce((m, line) => m + pathLength(line), 0);
		case 'Polygon':
			return pathLength(geometry.coordinates[0] ?? []);
		case 'MultiPolygon':
			return geometry.coordinates.reduce((m, poly) => m + pathLength(poly[0] ?? []), 0);
		case 'GeometryCollection':
			return geometry.geometries.reduce((m, g) => m + geometryLength(g), 0);
		default:
			return 0;
	}
}

export function featuresLength(features: Feature[]): number {
	return features.reduce((m, f) => m + geometryLength(f.geometry), 0);
}

export function featuresPointCount(features: Feature[]): number {
	return features.reduce((n, f) => n + geometryPointCount(f.geometry), 0);
}

export function distanceLabelFromFeatures(features: Feature[]): string {
	return formatDistance(featuresLength(features));
}

export function pointLabelFromCount(count: number): string {
	return `${count} sketch pts`;
}
