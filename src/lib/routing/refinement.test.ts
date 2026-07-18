import { describe, expect, it } from 'vitest';
import type { LineString } from 'geojson';
import type { WaypointDetourAnalysis } from './detours';
import {
	buildRefinementPlan,
	improvesDetourScore,
	routeRequestHash,
	scoreRouteDetours
} from './refinement';

const geometry: LineString = {
	type: 'LineString',
	coordinates: [
		[21, 52],
		[21.001, 52],
		[21.002, 52],
		[21.003, 52]
	]
};

const analysis: WaypointDetourAnalysis[] = [
	{ waypointIndex: 0, candidate: null },
	{
		waypointIndex: 1,
		candidate: {
			geometry: {
				type: 'LineString',
				coordinates: geometry.coordinates.slice(1, 3)
			},
			startIndex: 1,
			endIndex: 2,
			routeDistanceM: 150,
			returnDistanceM: 100,
			excessDistanceM: 50
		}
	},
	{ waypointIndex: 2, candidate: null }
];

describe('buildRefinementPlan', () => {
	it('moves detour candidates with OSRM constraints and removes selected vias', () => {
		const result = buildRefinementPlan(
			geometry,
			[
				[21, 52],
				[21.002, 52],
				[21.003, 52]
			],
			analysis,
			{ 2: 'remove' }
		);

		expect(result).toEqual({
			request: {
				vias: [
					{ location: [21, 52] },
					{ location: [21.001, 52], radiusM: 20, bearing: 90, bearingRange: 45 }
				],
				continueStraight: true
			},
			preservedOverrides: {}
		});
	});
});

describe('automatic refinement policy', () => {
	it('scores candidate count and excess distance', () => {
		expect(scoreRouteDetours(analysis, 500)).toEqual({
			candidateCount: 1,
			excessDistanceM: 50,
			distanceM: 500
		});
	});

	it('accepts fewer candidates unless the route grows by more than ten percent', () => {
		const previous = { candidateCount: 1, excessDistanceM: 50, distanceM: 500 };
		expect(
			improvesDetourScore({ candidateCount: 0, excessDistanceM: 0, distanceM: 540 }, previous)
		).toBe(true);
		expect(
			improvesDetourScore({ candidateCount: 0, excessDistanceM: 0, distanceM: 551 }, previous)
		).toBe(false);
	});

	it('hashes locations and snapping constraints from the outgoing request', () => {
		const request = {
			vias: [
				{ location: [21.1234564, 52.1] },
				{
					location: [21.2, 52.6543214],
					radiusM: 20,
					bearing: 45,
					bearingRange: 30
				}
			],
			continueStraight: true
		};

		expect(routeRequestHash(request)).not.toBe(
			routeRequestHash({
				...request,
				vias: [request.vias[0]!, { ...request.vias[1]!, bearing: 90 }]
			})
		);
	});
});
