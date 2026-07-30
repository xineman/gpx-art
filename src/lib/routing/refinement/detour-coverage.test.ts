import { describe, expect, it } from 'vitest';
import type { LineString } from 'geojson';
import type { WaypointDetourAnalysis } from './detours';
import { applySelectionsToWaypointAnalysis, applyWaypointSelection } from './detour-coverage';

function line(startIndex: number, endIndex: number): LineString {
	return {
		type: 'LineString',
		coordinates: [
			[startIndex, 0],
			[endIndex, 0]
		]
	};
}

function makeAnalysis(
	waypointIndex: number,
	startIndex: number,
	endIndex: number,
	coveredByWaypointIndexes: number[]
): WaypointDetourAnalysis {
	return {
		waypointIndex,
		candidate: {
			geometry: line(startIndex, endIndex),
			startIndex,
			endIndex,
			routeDistanceM: endIndex - startIndex,
			returnDistanceM: 0,
			excessDistanceM: endIndex - startIndex
		},
		coveredByWaypointIndexes,
		action: coveredByWaypointIndexes.length > 0 ? 'remove' : 'move'
	};
}

describe('waypoint refinement selections', () => {
	it('lets an explicit keep suppress its covering move without treating coverage as symmetric', () => {
		const analysis = [makeAnalysis(1, 0, 6, []), makeAnalysis(2, 3, 5, [1])];

		expect(applySelectionsToWaypointAnalysis(analysis).map(({ action }) => action)).toEqual([
			'move',
			'remove'
		]);
		expect(
			applySelectionsToWaypointAnalysis(analysis, [{ waypointIndex: 2, action: 'keep' }]).map(
				({ action }) => action
			)
		).toEqual(['remove', 'keep']);
		expect(
			applySelectionsToWaypointAnalysis(analysis, [
				{ waypointIndex: 1, action: 'keep' },
				{ waypointIndex: 2, action: 'move' }
			]).map(({ action }) => action)
		).toEqual(['keep', 'move']);
	});

	it('gives a user-preferred covered candidate precedence over its covering detour', () => {
		const analysis = [makeAnalysis(1, 0, 6, []), makeAnalysis(2, 3, 5, [1])];

		expect(
			applySelectionsToWaypointAnalysis(analysis, [{ waypointIndex: 2, action: 'move' }]).map(
				({ action }) => action
			)
		).toEqual(['remove', 'move']);
	});

	it('discards an older selection when a newer selection conflicts with it', () => {
		const analysis = [makeAnalysis(1, 0, 6, []), makeAnalysis(2, 3, 5, [1])];
		const keepCovered = [{ waypointIndex: 2, action: 'keep' as const }];

		expect(
			applyWaypointSelection(analysis, keepCovered, { waypointIndex: 1, action: 'move' })
		).toEqual([{ waypointIndex: 1, action: 'move' }]);
		expect(
			applyWaypointSelection(analysis, [{ waypointIndex: 1, action: 'move' }], {
				waypointIndex: 2,
				action: 'keep'
			})
		).toEqual([{ waypointIndex: 2, action: 'keep' }]);
	});

	it('uses newest-first selection order when incompatible moves were both selected', () => {
		const analysis = [makeAnalysis(1, 0, 6, []), makeAnalysis(2, 3, 5, [1])];

		expect(
			applySelectionsToWaypointAnalysis(analysis, [
				{ waypointIndex: 1, action: 'move' },
				{ waypointIndex: 2, action: 'move' }
			]).map(({ action }) => action)
		).toEqual(['move', 'remove']);
		expect(
			applySelectionsToWaypointAnalysis(analysis, [
				{ waypointIndex: 2, action: 'move' },
				{ waypointIndex: 1, action: 'move' }
			]).map(({ action }) => action)
		).toEqual(['remove', 'move']);
	});
});
