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

	it('re-merges only the supplied waypoint candidates', () => {
		const route = line([
			[21, 52],
			[21.001, 52],
			[21.002, 52],
			[21.003, 52],
			[21.004, 52]
		]);
		const makeCandidate = (startIndex: number, endIndex: number) => ({
			geometry: line(route.coordinates.slice(startIndex, endIndex + 1)),
			startIndex,
			endIndex,
			routeDistanceM: 100,
			returnDistanceM: 10,
			excessDistanceM: 90
		});
		const first = makeCandidate(0, 2);
		const second = makeCandidate(2, 4);

		expect(mergeRouteDetourCandidates(route, [first, second])).toMatchObject([
			{ startIndex: 0, endIndex: 4 }
		]);
		expect(mergeRouteDetourCandidates(route, [second])).toMatchObject([
			{ startIndex: 2, endIndex: 4 }
		]);
	});
});
