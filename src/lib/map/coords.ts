import type {
	Feature,
	FeatureCollection,
	GeoJsonProperties,
	LineString,
	Point as GeoJsonPoint,
	Polygon
} from 'geojson';
import type { Point } from '$lib/types/sketch';

/** GeoJSON position: [longitude, latitude]. */
export type LngLatTuple = [number, number];

export function toLngLat(point: Point): LngLatTuple {
	return [point.lng, point.lat];
}

export function fromLngLat(lng: number, lat: number): Point {
	return { lat, lng };
}

export function pointsToLineCoords(points: readonly Point[]): LngLatTuple[] {
	return points.map(toLngLat);
}

/** Closed ring for Polygon: first point repeated at end if needed. */
export function pointsToRingCoords(points: readonly Point[]): LngLatTuple[] {
	const coords = pointsToLineCoords(points);
	if (coords.length < 2) return coords;
	const first = coords[0];
	const last = coords[coords.length - 1];
	if (first[0] === last[0] && first[1] === last[1]) return coords;
	return [...coords, first];
}

export function emptyFeatureCollection(): FeatureCollection {
	return { type: 'FeatureCollection', features: [] };
}

export function lineFeature(
	points: readonly Point[],
	properties: GeoJsonProperties = {}
): Feature<LineString> | null {
	if (points.length < 2) return null;
	return {
		type: 'Feature',
		properties,
		geometry: {
			type: 'LineString',
			coordinates: pointsToLineCoords(points)
		}
	};
}

export function polygonFeature(
	points: readonly Point[],
	properties: GeoJsonProperties = {}
): Feature<Polygon> | null {
	if (points.length < 3) return null;
	return {
		type: 'Feature',
		properties,
		geometry: {
			type: 'Polygon',
			coordinates: [pointsToRingCoords(points)]
		}
	};
}

export function pointFeature(
	point: Point,
	properties: GeoJsonProperties = {}
): Feature<GeoJsonPoint> {
	return {
		type: 'Feature',
		properties,
		geometry: {
			type: 'Point',
			coordinates: toLngLat(point)
		}
	};
}

export function featureCollection(features: Array<Feature | null | undefined>): FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: features.filter((f): f is Feature => f != null)
	};
}
