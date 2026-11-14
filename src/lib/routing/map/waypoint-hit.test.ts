import { describe, expect, it } from 'vitest';
import type { Map as MaplibreMap, MapGeoJSONFeature } from 'maplibre-gl';
import { routeWaypointAtPoint } from './waypoint-hit';

function waypointFeature(index: number, coordinates: [number, number], interactive = true) {
	return {
		properties: { index, interactive },
		geometry: { type: 'Point', coordinates }
	} as unknown as MapGeoJSONFeature;
}

function mockMap(features: MapGeoJSONFeature[]): MaplibreMap {
	return {
		getLayer: () => ({}),
		queryRenderedFeatures: () => features,
		project: ([x, y]: [number, number]) => ({ x, y })
	} as unknown as MaplibreMap;
}

describe('routeWaypointAtPoint', () => {
	it('returns the nearest interactive waypoint inside the padded hit area', () => {
		const map = mockMap([
			waypointFeature(2, [12, 0]),
			waypointFeature(1, [5, 0]),
			waypointFeature(0, [1, 0], false)
		]);

		expect(routeWaypointAtPoint(map, [0, 0])).toBe(1);
	});

	it('ignores waypoint centers outside the radius and missing layers', () => {
		expect(routeWaypointAtPoint(mockMap([waypointFeature(1, [21, 0])]), [0, 0])).toBeNull();
		const noLayer = { getLayer: () => undefined } as unknown as MaplibreMap;
		expect(routeWaypointAtPoint(noLayer, [0, 0])).toBeNull();
	});
});
