import { describe, expect, it } from 'vitest';
import type { LineString } from 'geojson';
import type { RouteDetour } from '../refinement/detours';
import { buildRouteMapFeatures } from './map-features';

const routeGeometry: LineString = {
	type: 'LineString',
	coordinates: [
		[21, 52],
		[21.001, 52],
		[21.002, 52],
		[21.003, 52]
	]
};

const detour: RouteDetour = {
	geometry: {
		type: 'LineString',
		coordinates: routeGeometry.coordinates.slice(1, 3)
	},
	startIndex: 1,
	endIndex: 2,
	routeDistanceM: 200,
	returnDistanceM: 80,
	excessDistanceM: 120
};

describe('route map features', () => {
	it('projects route state into map-ready route, detour, and waypoint features', () => {
		const collection = buildRouteMapFeatures({
			routeGeometry,
			waypoints: [
				{ coordinates: [21, 52], candidate: false, action: 'keep' },
				{ coordinates: [21.002, 52], candidate: true, action: 'move' },
				{ coordinates: [21.003, 52], candidate: false, action: 'remove' }
			],
			moveProposals: [
				{
					waypointIndex: 1,
					from: [21.002, 52],
					to: [21.001, 52],
					detour
				}
			],
			highlightedMoveWaypointIndex: 1,
			activeRoadSpan: null,
			interactive: true
		});

		expect(collection.features.map((feature) => feature.properties?.kind)).toEqual([
			'route',
			'detour',
			'move-link',
			'move-target',
			'waypoint',
			'waypoint',
			'waypoint'
		]);
		expect(
			collection.features
				.filter((feature) => feature.properties?.kind === 'waypoint')
				.map((feature) => feature.properties)
		).toEqual([
			{
				kind: 'waypoint',
				index: 0,
				role: 'start',
				candidate: false,
				action: 'keep',
				activeMove: false,
				interactive: true
			},
			{
				kind: 'waypoint',
				index: 1,
				role: 'via',
				candidate: true,
				action: 'move',
				activeMove: true,
				interactive: true
			},
			{
				kind: 'waypoint',
				index: 2,
				role: 'end',
				candidate: false,
				action: 'remove',
				activeMove: false,
				interactive: true
			}
		]);
		expect(collection.features.find((feature) => feature.properties?.kind === 'move-link')).toEqual(
			{
				type: 'Feature',
				properties: { kind: 'move-link', waypointIndex: 1, activeMove: true },
				geometry: {
					type: 'LineString',
					coordinates: [
						[21.002, 52],
						[21.001, 52]
					]
				}
			}
		);
	});

	it('slices a valid active road span and ignores an invalid one', () => {
		const input = {
			routeGeometry,
			waypoints: [],
			moveProposals: [],
			highlightedMoveWaypointIndex: null,
			interactive: false
		};
		const highlighted = buildRouteMapFeatures({
			...input,
			activeRoadSpan: {
				roadKind: 'national',
				startShapeIndex: 1,
				endShapeIndex: 2
			}
		});

		expect(highlighted.features[1]).toMatchObject({
			properties: { kind: 'road-highlight', roadKind: 'national' },
			geometry: {
				type: 'LineString',
				coordinates: routeGeometry.coordinates.slice(1, 3)
			}
		});

		const invalid = buildRouteMapFeatures({
			...input,
			activeRoadSpan: {
				roadKind: 'national',
				startShapeIndex: 2,
				endShapeIndex: 9
			}
		});
		expect(invalid.features).toHaveLength(1);
	});
});
