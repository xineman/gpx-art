import { describe, expect, it } from 'vitest';
import type { LineString, Position } from 'geojson';
import {
	analyzeRouteDetours,
	isMeaningfulDetourCandidate,
	mergeRouteDetourCandidates
} from './detours';

function line(coordinates: Position[]): LineString {
	return { type: 'LineString', coordinates };
}

describe('analyzeRouteDetours', () => {
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
