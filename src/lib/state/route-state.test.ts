import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Feature } from 'geojson';

const { requestRouteMock } = vi.hoisted(() => ({ requestRouteMock: vi.fn() }));

vi.mock('$lib/routing/client', () => ({ requestRoute: requestRouteMock }));

import { route } from './route.svelte';

const line: Feature = {
	type: 'Feature',
	properties: { id: 'line', tool: 'polyline' },
	geometry: {
		type: 'LineString',
		coordinates: [
			[21, 52],
			[21.01, 52.01]
		]
	}
};

const success = {
	ok: true as const,
	geometry: {
		type: 'LineString' as const,
		coordinates: [
			[21, 52],
			[21.01, 52.01]
		]
	},
	distanceM: 1_300,
	waypoints: [
		[21, 52],
		[21.01, 52.01]
	]
};

const ordinarySuccess = {
	ok: true as const,
	geometry: {
		type: 'LineString' as const,
		coordinates: [
			[21, 52],
			[21.001, 52],
			[21.002, 52.001],
			[21.003, 52.001]
		]
	},
	distanceM: 350,
	waypoints: [
		[21, 52],
		[21.002, 52.001],
		[21.003, 52.001]
	]
};

const straightSuccess = {
	ok: true as const,
	geometry: {
		type: 'LineString' as const,
		coordinates: [
			[21, 52],
			[21.001, 52],
			[21.002, 52],
			[21.003, 52]
		]
	},
	distanceM: 205,
	waypoints: [
		[21, 52],
		[21.002, 52],
		[21.003, 52]
	]
};

const mixedSuccess = {
	ok: true as const,
	geometry: {
		type: 'LineString' as const,
		coordinates: [
			[21, 52],
			[21.001, 52],
			[21.002, 52],
			[21.002, 52.002],
			[21.002, 52],
			[21.003, 52],
			[21.004, 52],
			[21.005, 52]
		]
	},
	distanceM: 900,
	waypoints: [
		[21, 52],
		[21.002, 52.002],
		[21.004, 52],
		[21.005, 52]
	]
};

afterEach(() => {
	route.clear();
	requestRouteMock.mockReset();
});

describe('route state', () => {
	it('marks a detected candidate as a move suggestion without changing route geometry', async () => {
		requestRouteMock.mockResolvedValue(ordinarySuccess);

		await route.generate([line], 3);

		expect(route.geometry).toEqual(ordinarySuccess.geometry);
		expect(route.isWaypointDetourCandidate(1)).toBe(true);
		expect(route.getWaypointAction(1)).toBe('move');
		expect(route.moveWaypointCount).toBe(1);
		expect(route.removeWaypointCount).toBe(0);
		expect(route.pendingWaypointCount).toBe(1);
		expect(route.detourCount).toBe(1);
		expect(
			route.collection.features.find((feature) => feature.properties?.index === 1)?.properties
		).toMatchObject({ candidate: true, action: 'move' });
		expect(
			route.collection.features.find((feature) => feature.properties?.kind === 'detour')?.geometry
		).toEqual(route.detours[0]!.geometry);
	});

	it('cycles a detected candidate through move, remove, and keep', async () => {
		requestRouteMock.mockResolvedValue(ordinarySuccess);
		await route.generate([line], 4);

		expect(route.cycleWaypointAction(1)).toBe('remove');
		expect(route.getWaypointAction(1)).toBe('remove');
		expect(route.moveWaypointCount).toBe(0);
		expect(route.removeWaypointCount).toBe(1);
		expect(route.detourCount).toBe(0);

		expect(route.cycleWaypointAction(1)).toBe('keep');
		expect(route.getWaypointAction(1)).toBe('keep');
		expect(route.pendingWaypointCount).toBe(0);
		expect(
			route.collection.features.find((feature) => feature.properties?.index === 1)?.properties
		).toMatchObject({ candidate: true, action: 'keep' });

		expect(route.cycleWaypointAction(1)).toBe('move');
		expect(route.getWaypointAction(1)).toBe('move');
		expect(route.detourCount).toBe(1);
	});

	it('cycles ordinary waypoints between keep and remove, including endpoints', async () => {
		requestRouteMock.mockResolvedValueOnce(straightSuccess).mockResolvedValueOnce(success);
		await route.generate([line], 5);

		expect(route.isWaypointDetourCandidate(1)).toBe(false);
		expect(route.getWaypointAction(1)).toBe('keep');
		expect(route.cycleWaypointAction(1)).toBe('remove');
		expect(route.cycleWaypointAction(0)).toBe('remove');
		expect(route.remainingWaypointCount).toBe(1);
		expect(route.canRefineRoute).toBe(false);

		expect(route.cycleWaypointAction(0)).toBe('keep');
		expect(route.remainingWaypointCount).toBe(2);
		expect(route.canRefineRoute).toBe(true);
		await route.refineRoute();
		expect(requestRouteMock).toHaveBeenNthCalledWith(2, [
			straightSuccess.waypoints[0],
			straightSuccess.waypoints[2]
		]);
	});

	it('moves a candidate to its detected detour entry during refinement', async () => {
		requestRouteMock.mockResolvedValueOnce(ordinarySuccess).mockResolvedValueOnce(success);
		await route.generate([line], 6);

		expect(route.canRefineRoute).toBe(true);
		await route.refineRoute();
		expect(requestRouteMock).toHaveBeenNthCalledWith(2, [
			ordinarySuccess.waypoints[0],
			[21.001, 52],
			ordinarySuccess.waypoints[2]
		]);
	});

	it('combines a move candidate with a removed ordinary waypoint', async () => {
		requestRouteMock.mockResolvedValueOnce(mixedSuccess).mockResolvedValueOnce(success);
		await route.generate([line], 7);

		expect(route.getWaypointAction(1)).toBe('move');
		expect(route.isWaypointDetourCandidate(2)).toBe(false);
		expect(route.cycleWaypointAction(2)).toBe('remove');
		expect(route.moveWaypointCount).toBe(1);
		expect(route.removeWaypointCount).toBe(1);
		await route.refineRoute();
		expect(requestRouteMock).toHaveBeenNthCalledWith(2, [
			mixedSuccess.waypoints[0],
			[21.002, 52],
			mixedSuccess.waypoints[3]
		]);
	});

	it('rejects refinement with no selected action or too few remaining waypoints', async () => {
		requestRouteMock.mockResolvedValue(straightSuccess);
		await route.generate([line], 8);

		await expect(route.refineRoute()).resolves.toEqual({
			ok: false,
			error: 'Choose at least one waypoint action to refine the route.'
		});

		route.cycleWaypointAction(0);
		route.cycleWaypointAction(1);
		expect(route.remainingWaypointCount).toBe(1);
		await expect(route.refineRoute()).resolves.toEqual({
			ok: false,
			error: 'Keep at least 2 waypoints to refine the route.'
		});
	});

	it('resets selected actions on reroute, clear, invalidation, and a fresh-route error', async () => {
		requestRouteMock.mockResolvedValue(ordinarySuccess);
		await route.generate([line], 9);
		route.cycleWaypointAction(1);
		expect(route.getWaypointAction(1)).toBe('remove');

		await route.generate([line], 9);
		expect(route.getWaypointAction(1)).toBe('move');
		route.cycleWaypointAction(1);
		route.clear();
		expect(route.getWaypointAction(1)).toBe('keep');

		await route.generate([line], 10);
		route.cycleWaypointAction(1);
		requestRouteMock.mockResolvedValueOnce({ ok: false, error: 'No route found.' });
		await expect(route.generate([line], 11)).resolves.toEqual({
			ok: false,
			error: 'No route found.'
		});
		expect(route.getWaypointAction(1)).toBe('keep');

		await route.generate([line], 12);
		route.cycleWaypointAction(1);
		route.syncSketch(13);
		expect(route.getWaypointAction(1)).toBe('keep');
	});

	it('resets selected actions when restoring the route from the sketch', async () => {
		requestRouteMock
			.mockResolvedValueOnce(ordinarySuccess)
			.mockResolvedValueOnce(success)
			.mockResolvedValueOnce(ordinarySuccess);
		await route.generate([line], 15);
		await route.refineRoute();
		expect(route.hasRefinedRoute).toBe(true);

		expect(route.cycleWaypointAction(0)).toBe('remove');
		expect(route.removeWaypointCount).toBe(1);
		await route.resetFromSketch([line], 15);
		expect(route.hasRefinedRoute).toBe(false);
		expect(route.removeWaypointCount).toBe(0);
		expect(route.getWaypointAction(1)).toBe('move');
	});

	it('preserves the selected actions when a refinement request fails', async () => {
		requestRouteMock
			.mockResolvedValueOnce(ordinarySuccess)
			.mockResolvedValueOnce({ ok: false, error: 'No route found.' });
		await route.generate([line], 14);
		route.cycleWaypointAction(1);

		await expect(route.refineRoute()).resolves.toEqual({ ok: false, error: 'No route found.' });
		expect(route.status).toBe('ready');
		expect(route.getWaypointAction(1)).toBe('remove');
		expect(route.errorMessage).toBe('No route found.');
	});
});
