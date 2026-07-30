import { describe, expect, it } from 'vitest';
import type { LineString, Position } from 'geojson';
import {
	analyzeRouteDetours,
	getWaypointDetourAnalysis,
	isMeaningfulDetourCandidate
} from './detours';

function line(coordinates: Position[]): LineString {
	return { type: 'LineString', coordinates };
}

describe('analyzeRouteDetours', () => {
	it('uses a keep recommendation before analysis is available', () => {
		expect(getWaypointDetourAnalysis([], 2)).toEqual({
			waypointIndex: 2,
			candidate: null,
			coveredByWaypointIndexes: [],
			action: 'keep'
		});
	});

	it('retains a candidate when an ordinary bend is not a tight hairpin', () => {
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

		expect(analysis[1]!.candidate).toMatchObject({
			startIndex: 1,
			endIndex: 3
		});
		expect(analysis[1]!.coveredByWaypointIndexes).toEqual([]);
		expect(isMeaningfulDetourCandidate(analysis[1]!.candidate!)).toBe(true);
	});

	it('returns null candidate for a straight waypoint span that is not a meaningful detour', () => {
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

		expect(analysis[1]!.candidate).toBeNull();
	});

	it('uses the nearest return on each adjacent leg for endpoint candidates', () => {
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
			candidate: { startIndex: 0, endIndex: 2 }
		});
		expect(analysis[2]).toMatchObject({
			candidate: { startIndex: 4, endIndex: 6 }
		});
	});

	it('returns null candidate when a via shares a route index with a neighbor', () => {
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

		expect(analysis[1]!.candidate).toBeNull();
	});

	it('removes a waypoint covered asymmetrically by a larger candidate', () => {
		const route = line([
			[21, 52],
			[21.001, 52],
			[21.002, 52],
			[21.003, 52],
			[21.002, 52],
			[21.001, 52],
			[21.004, 52],
			[21.005, 52]
		]);
		const analysis = analyzeRouteDetours(route, [
			[21, 52],
			[21.003, 52],
			[21.004, 52],
			[21.005, 52]
		]);

		expect(analysis.map(({ action }) => action)).toEqual(['keep', 'remove', 'move', 'keep']);
		expect(analysis[1]!.candidate).not.toBeNull();
		expect(analysis[2]!.candidate).not.toBeNull();
		expect(analysis[1]!.coveredByWaypointIndexes).toContain(2);
		expect(analysis[2]!.coveredByWaypointIndexes).toEqual([]);
	});

	it('keeps nearby candidates when neither detour covers the other waypoint', () => {
		const route = line([
			[21, 52],
			[21.001, 52],
			[21.0001, 52],
			[21.002, 52],
			[21.003, 52]
		]);
		const analysis = analyzeRouteDetours(route, [
			[21, 52],
			[21.002, 52],
			[21.003, 52]
		]);

		expect(analysis.map(({ action }) => action)).toEqual(['move', 'move', 'keep']);
		expect(analysis[0]!.candidate).toMatchObject({
			startIndex: 0,
			endIndex: 2
		});
	});

	it('preserves both route endpoints when their candidates cover each other', () => {
		const route = line([
			[21, 52],
			[21.005, 52],
			[21.005, 52.005],
			[21.0001, 52]
		]);
		const analysis = analyzeRouteDetours(route, [
			[21, 52],
			[21.0001, 52]
		]);

		expect(analysis.map(({ action }) => action)).toEqual(['move', 'move']);
		expect(analysis[0]!.coveredByWaypointIndexes).toEqual([]);
		expect(analysis[1]!.coveredByWaypointIndexes).toEqual([]);
	});
});
