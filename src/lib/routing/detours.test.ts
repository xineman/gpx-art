import { describe, expect, it } from 'vitest';
import type { LineString, Position } from 'geojson';
import { detectRouteDetours } from './detours';

function line(coordinates: Position[]): LineString {
	return { type: 'LineString', coordinates };
}

describe('detectRouteDetours', () => {
	it('marks a waypoint-driven out-and-back excursion', () => {
		const route = line([
			[21, 52],
			[21.001, 52],
			[21.002, 52],
			[21.002, 52.002],
			[21.002, 52],
			[21.003, 52]
		]);
		const waypoints: Position[] = [
			[21, 52],
			[21.002, 52.002],
			[21.003, 52]
		];

		const detours = detectRouteDetours(route, waypoints);

		expect(detours).toHaveLength(1);
		expect(detours[0]).toMatchObject({
			startIndex: 2,
			endIndex: 4,
			waypointIndexes: [1],
			returnDistanceM: 0
		});
		expect(detours[0]!.geometry.coordinates).toEqual(route.coordinates.slice(2, 5));
	});

	it('marks the small retraced Osowska waypoint spur', () => {
		const route = line([
			[21.095462, 52.247504],
			[21.094994, 52.246885],
			[21.094957, 52.246836],
			[21.094419, 52.246865],
			[21.094957, 52.246836],
			[21.094908, 52.246773],
			[21.095195, 52.24675]
		]);

		const detours = detectRouteDetours(route, [
			[21.095462, 52.247504],
			[21.094419, 52.246865],
			[21.095195, 52.24675]
		]);

		expect(detours).toHaveLength(1);
		expect(detours[0]).toMatchObject({
			startIndex: 2,
			endIndex: 4,
			waypointIndexes: [1],
			returnDistanceM: 0
		});
		expect(detours[0]!.routeDistanceM).toBeGreaterThan(70);
	});

	it('does not mark an ordinary road bend', () => {
		const route = line([
			[21, 52],
			[21.001, 52],
			[21.002, 52.001],
			[21.003, 52.001]
		]);

		expect(
			detectRouteDetours(route, [
				[21, 52],
				[21.002, 52.001],
				[21.003, 52.001]
			])
		).toEqual([]);
	});

	it('ignores short turnarounds below the noise thresholds', () => {
		const route = line([
			[21, 52],
			[21.0001, 52],
			[21.0001, 52.0002],
			[21.0001, 52],
			[21.0002, 52]
		]);

		expect(
			detectRouteDetours(route, [
				[21, 52],
				[21.0001, 52.0002],
				[21.0002, 52]
			])
		).toEqual([]);
	});

	it('does not flag a loop unless an intermediate waypoint lies inside it', () => {
		const route = line([
			[21, 52],
			[21.001, 52],
			[21.001, 52.002],
			[21.001, 52],
			[21.002, 52],
			[21.003, 52]
		]);

		expect(
			detectRouteDetours(route, [
				[21, 52],
				[21.002, 52],
				[21.003, 52]
			])
		).toEqual([]);
	});

	it('can detect a near-return when the two route sides do not exactly overlap', () => {
		const route = line([
			[21, 52],
			[21.001, 52],
			[21.002, 52],
			[21.002, 52.002],
			[21.0024, 52.0002],
			[21.003, 52]
		]);

		const detours = detectRouteDetours(route, [
			[21, 52],
			[21.002, 52.002],
			[21.003, 52]
		]);

		expect(detours).toHaveLength(1);
		expect(detours[0]!.returnDistanceM).toBeGreaterThan(0);
		expect(detours[0]!.returnDistanceM).toBeLessThan(70);
	});
});
