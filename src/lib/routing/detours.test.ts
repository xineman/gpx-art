import { describe, expect, it } from 'vitest';
import type { LineString, Position } from 'geojson';
import {
	analyzeRouteDetours,
	detectRouteDetours,
	isMeaningfulDetourCandidate,
	mergeRouteDetourCandidates
} from './detours';

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

	it('retains a relaxed manual candidate when an ordinary bend fails automatic thresholds', () => {
		const route = line([
			[21, 52],
			[21.001, 52],
			[21.002, 52.001],
			[21.003, 52.001]
		]);
		const analysis = analyzeRouteDetours(route, [
			[21, 52],
			[21.002, 52.001],
			[21.003, 52.001]
		]);

		expect(analysis[1]!.automatic).toBeNull();
		expect(analysis[1]!.manual).toMatchObject({
			startIndex: 1,
			endIndex: 3,
			waypointIndexes: [1]
		});
		expect(isMeaningfulDetourCandidate(analysis[1]!.manual!)).toBe(true);
	});

	it('classifies a straight waypoint span as a redundant routing constraint', () => {
		const route = line([
			[21, 52],
			[21.001, 52],
			[21.002, 52],
			[21.003, 52]
		]);
		const analysis = analyzeRouteDetours(route, [
			[21, 52],
			[21.002, 52],
			[21.003, 52]
		]);

		expect(analysis[1]!.manual).not.toBeNull();
		expect(isMeaningfulDetourCandidate(analysis[1]!.manual!)).toBe(false);
	});

	it('uses the nearest return on each adjacent leg for manual endpoint candidates', () => {
		const route = line([
			[21, 52],
			[21.001, 52],
			[21.0001, 52],
			[21.002, 52],
			[21.0041, 52],
			[21.005, 52],
			[21.004, 52]
		]);
		const analysis = analyzeRouteDetours(route, [
			[21, 52],
			[21.002, 52],
			[21.004, 52]
		]);

		expect(analysis[0]).toMatchObject({
			automatic: null,
			manual: { startIndex: 0, endIndex: 2, waypointIndexes: [0] }
		});
		expect(analysis[2]).toMatchObject({
			automatic: null,
			manual: { startIndex: 4, endIndex: 6, waypointIndexes: [2] }
		});
	});

	it('falls back to distinct route coordinates when a via shares a route index', () => {
		const route = line([
			[21, 52],
			[21, 52],
			[21.001, 52],
			[21.002, 52]
		]);
		const analysis = analyzeRouteDetours(route, [
			[21, 52],
			[21, 52],
			[21.002, 52]
		]);

		expect(analysis[1]!.manual).toMatchObject({ startIndex: 0, endIndex: 2 });
		expect(analysis[1]!.manual?.geometry.coordinates).toEqual(route.coordinates.slice(0, 3));
	});

	it('re-merges only the supplied waypoint candidates', () => {
		const route = line([
			[21, 52],
			[21.001, 52],
			[21.002, 52],
			[21.003, 52],
			[21.004, 52]
		]);
		const makeCandidate = (startIndex: number, endIndex: number, waypointIndex: number) => ({
			geometry: line(route.coordinates.slice(startIndex, endIndex + 1)),
			startIndex,
			endIndex,
			waypointIndexes: [waypointIndex],
			routeDistanceM: 100,
			returnDistanceM: 10,
			excessDistanceM: 90
		});
		const first = makeCandidate(0, 2, 1);
		const second = makeCandidate(2, 4, 2);

		expect(mergeRouteDetourCandidates(route, [first, second])).toMatchObject([
			{ startIndex: 0, endIndex: 4, waypointIndexes: [1, 2] }
		]);
		expect(mergeRouteDetourCandidates(route, [second])).toMatchObject([
			{ startIndex: 2, endIndex: 4, waypointIndexes: [2] }
		]);
	});
});
