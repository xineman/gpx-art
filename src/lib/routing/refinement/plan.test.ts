import { describe, expect, it } from 'vitest';
import type { LineString } from 'geojson';
import type { WaypointDetourAnalysis } from './detours';
import { applySelectionsToWaypointAnalysis } from './detour-coverage';
import {
	buildRefinementPlan,
	improvesDetourScore,
	routeRequestHash,
	scoreRouteDetours
} from './plan';

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
	{
		waypointIndex: 0,
		candidate: null,
		coveredByWaypointIndexes: [],
		action: 'keep'
	},
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
		},
		coveredByWaypointIndexes: [],
		action: 'move'
	},
	{
		waypointIndex: 2,
		candidate: null,
		coveredByWaypointIndexes: [],
		action: 'keep'
	}
];

describe('buildRefinementPlan', () => {
	it('moves detour candidates with road-snapping constraints and removes selected vias', () => {
		const result = buildRefinementPlan(
			geometry,
			[
				[21, 52],
				[21.002, 52],
				[21.003, 52]
			],
			applySelectionsToWaypointAnalysis(analysis, [{ waypointIndex: 2, action: 'remove' }])
		);

		expect(result).toEqual({
			request: {
				vias: [
					{ location: [21, 52] },
					{ location: [21.001, 52], radiusM: 20, bearing: 90, bearingRange: 45 }
				]
			},
			nextSelections: []
		});
	});

	it('moves a covering candidate and omits the covered waypoint', () => {
		const clusteredAnalysis: WaypointDetourAnalysis[] = [
			{
				waypointIndex: 0,
				candidate: null,
				coveredByWaypointIndexes: [],
				action: 'keep'
			},
			analysis[1]!,
			{
				waypointIndex: 2,
				candidate: {
					geometry: {
						type: 'LineString',
						coordinates: geometry.coordinates.slice(2, 4)
					},
					startIndex: 2,
					endIndex: 3,
					routeDistanceM: 130,
					returnDistanceM: 100,
					excessDistanceM: 30
				},
				coveredByWaypointIndexes: [1],
				action: 'remove'
			},
			{
				waypointIndex: 3,
				candidate: null,
				coveredByWaypointIndexes: [],
				action: 'keep'
			}
		];

		const result = buildRefinementPlan(
			geometry,
			[
				[21, 52],
				[21.002, 52],
				[21.0025, 52],
				[21.003, 52]
			],
			applySelectionsToWaypointAnalysis(clusteredAnalysis)
		);

		expect(result.request.vias).toEqual([
			{ location: [21, 52] },
			{
				location: [21.001, 52],
				radiusM: 20,
				bearing: 90,
				bearingRange: 45
			},
			{ location: [21.003, 52] }
		]);
	});

	it('remaps an explicit keep selection after removing an earlier waypoint', () => {
		const selections = [
			{ waypointIndex: 2, action: 'keep' as const },
			{ waypointIndex: 1, action: 'remove' as const }
		];
		const result = buildRefinementPlan(
			geometry,
			[
				[21, 52],
				[21.002, 52],
				[21.003, 52]
			],
			applySelectionsToWaypointAnalysis(analysis, selections),
			selections
		);

		expect(result).toEqual({
			request: {
				vias: [{ location: [21, 52] }, { location: [21.003, 52] }]
			},
			nextSelections: [{ waypointIndex: 1, action: 'keep' }]
		});
	});

	it('does not remap an older keep superseded by a newer selection', () => {
		const selections = [
			{ waypointIndex: 1, action: 'move' as const },
			{ waypointIndex: 1, action: 'keep' as const }
		];
		const result = buildRefinementPlan(
			geometry,
			[
				[21, 52],
				[21.002, 52],
				[21.003, 52]
			],
			applySelectionsToWaypointAnalysis(analysis, selections),
			selections
		);

		expect(result.nextSelections).toEqual([]);
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
			]
		};

		expect(routeRequestHash(request)).not.toBe(
			routeRequestHash({
				...request,
				vias: [request.vias[0]!, { ...request.vias[1]!, bearing: 90 }]
			})
		);
	});
});
