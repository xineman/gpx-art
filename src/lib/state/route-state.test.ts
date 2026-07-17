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

const detourSuccess = {
	ok: true as const,
	geometry: {
		type: 'LineString' as const,
		coordinates: [
			[21, 52],
			[21.001, 52],
			[21.002, 52],
			[21.002, 52.002],
			[21.002, 52],
			[21.003, 52]
		]
	},
	distanceM: 700,
	waypoints: [
		[21, 52],
		[21.002, 52.002],
		[21.003, 52]
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

const combinedDetourSuccess = {
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
			[21.004, 52]
		]
	},
	distanceM: 900,
	waypoints: [
		[21, 52],
		[21.002, 52.002],
		[21.003, 52],
		[21.004, 52]
	]
};

const loopWaypointsSuccess = {
	ok: true as const,
	geometry: {
		type: 'LineString' as const,
		coordinates: [
			[21, 52],
			[21.002, 52],
			[21, 52],
			[21.003, 52]
		]
	},
	distanceM: 500,
	waypoints: [
		[21, 52],
		[21.002, 52],
		[21, 52],
		[21.003, 52]
	]
};

afterEach(() => {
	route.clear();
	requestRouteMock.mockReset();
});

describe('route state', () => {
	it('adds detour overlays without changing the route geometry', async () => {
		requestRouteMock.mockResolvedValue(detourSuccess);

		await route.generate([line], 3);

		expect(route.detourCount).toBe(1);
		expect(route.geometry).toEqual(detourSuccess.geometry);
		expect(
			route.collection.features.find((feature) => feature.properties?.kind === 'route')?.geometry
		).toEqual(detourSuccess.geometry);
		expect(
			route.collection.features.find((feature) => feature.properties?.kind === 'detour')?.geometry
		).toEqual(route.detours[0]!.geometry);
	});

	it('suppresses and restores an automatically detected waypoint', async () => {
		requestRouteMock.mockResolvedValue(detourSuccess);
		await route.generate([line], 20);

		expect(route.isWaypointDetour(1)).toBe(true);
		expect(route.toggleDetourWaypoint(1)).toBe('removed');
		expect(route.isWaypointDetour(1)).toBe(false);
		expect(route.detourCount).toBe(0);
		expect(
			route.collection.features.find((feature) => feature.properties?.index === 1)?.properties
		).toMatchObject({ detour: false });

		expect(route.toggleDetourWaypoint(1)).toBe('added');
		expect(route.isWaypointDetour(1)).toBe(true);
		expect(route.detourCount).toBe(1);
	});

	it('adds and removes a relaxed manual detour candidate', async () => {
		requestRouteMock.mockResolvedValue(ordinarySuccess);
		await route.generate([line], 21);

		expect(route.detourCount).toBe(0);
		expect(route.toggleDetourWaypoint(1)).toBe('added');
		expect(route.detourCount).toBe(1);
		expect(route.detours[0]).toMatchObject({ waypointIndexes: [1] });
		expect(
			route.collection.features.find((feature) => feature.properties?.index === 1)?.properties
		).toMatchObject({ role: 'via', detour: true });

		expect(route.toggleDetourWaypoint(1)).toBe('removed');
		expect(route.detourCount).toBe(0);
	});

	it('removes a marked waypoint on a straight span without drawing a detour overlay', async () => {
		requestRouteMock.mockResolvedValueOnce(straightSuccess).mockResolvedValueOnce(success);
		await route.generate([line], 21);

		expect(route.toggleDetourWaypoint(1)).toBe('added');
		expect(route.markedWaypointCount).toBe(1);
		expect(route.detourCount).toBe(0);
		expect(route.remainingWaypointCount).toBe(2);

		await route.refineRoute();
		expect(requestRouteMock).toHaveBeenNthCalledWith(2, [
			straightSuccess.waypoints[0],
			straightSuccess.waypoints[2]
		]);
	});

	it('allows both endpoint waypoints to become manual detours', async () => {
		requestRouteMock.mockResolvedValue(ordinarySuccess);
		await route.generate([line], 22);

		expect(route.toggleDetourWaypoint(0)).toBe('added');
		expect(route.toggleDetourWaypoint(2)).toBe('added');
		expect(route.isWaypointDetour(0)).toBe(true);
		expect(route.isWaypointDetour(2)).toBe(true);

		const endpoints = route.collection.features.filter(
			(feature) => feature.properties?.role === 'start' || feature.properties?.role === 'end'
		);
		expect(endpoints.map((feature) => feature.properties)).toMatchObject([
			{ index: 0, role: 'start', detour: true },
			{ index: 2, role: 'end', detour: true }
		]);
	});

	it('moves automatic and manual marked waypoints to their detour entries', async () => {
		const refined = {
			...success,
			waypoints: [
				combinedDetourSuccess.waypoints[0]!,
				[21.002, 52],
				combinedDetourSuccess.waypoints[2]!
			]
		};
		requestRouteMock.mockResolvedValueOnce(combinedDetourSuccess).mockResolvedValueOnce(refined);
		await route.generate([line], 30);

		expect(route.isWaypointDetour(1)).toBe(true);
		route.toggleDetourWaypoint(3);
		expect(route.markedWaypointCount).toBe(2);
		expect(route.remainingWaypointCount).toBe(3);
		expect(route.canRefineRoute).toBe(true);

		await expect(route.refineRoute()).resolves.toEqual(refined);
		expect(requestRouteMock).toHaveBeenNthCalledWith(2, [
			combinedDetourSuccess.waypoints[0],
			[21.002, 52],
			combinedDetourSuccess.waypoints[2]
		]);
		expect(route.hasRefinedRoute).toBe(true);
		expect(route.markedWaypointCount).toBe(0);
	});

	it('deduplicates relocated and retained waypoints before refinement', async () => {
		requestRouteMock.mockResolvedValueOnce(loopWaypointsSuccess).mockResolvedValueOnce(success);
		await route.generate([line], 31);

		expect(route.isWaypointDetour(1)).toBe(true);
		expect(route.markedWaypointCount).toBe(2);
		expect(route.remainingWaypointCount).toBe(3);
		await route.refineRoute();
		expect(requestRouteMock).toHaveBeenNthCalledWith(2, [
			loopWaypointsSuccess.waypoints[0],
			loopWaypointsSuccess.waypoints[1],
			loopWaypointsSuccess.waypoints[3]
		]);
	});

	it('moves a marked start to its return and a marked via to its entry', async () => {
		requestRouteMock.mockResolvedValueOnce(ordinarySuccess).mockResolvedValueOnce(success);
		await route.generate([line], 32);
		route.toggleDetourWaypoint(0);
		route.toggleDetourWaypoint(1);

		expect(route.markedWaypointCount).toBe(2);
		expect(route.remainingWaypointCount).toBe(2);
		expect(route.canRefineRoute).toBe(true);
		await route.refineRoute();
		expect(requestRouteMock).toHaveBeenNthCalledWith(2, [
			[21.001, 52],
			ordinarySuccess.waypoints[2]
		]);
	});

	it('uses the latest refined waypoint set for another refinement', async () => {
		requestRouteMock
			.mockResolvedValueOnce(combinedDetourSuccess)
			.mockResolvedValueOnce(detourSuccess)
			.mockResolvedValueOnce(success);
		await route.generate([line], 33);
		route.toggleDetourWaypoint(3);
		await route.refineRoute();

		expect(route.isWaypointDetour(1)).toBe(true);
		await route.refineRoute();
		expect(requestRouteMock).toHaveBeenNthCalledWith(3, [
			detourSuccess.waypoints[0],
			[21.002, 52],
			detourSuccess.waypoints[2]
		]);
		expect(route.hasRefinedRoute).toBe(true);
	});

	it('preserves the ready route when refinement fails', async () => {
		requestRouteMock
			.mockResolvedValueOnce(detourSuccess)
			.mockResolvedValueOnce({ ok: false, error: 'No route found.' });
		await route.generate([line], 34);
		const previousGeometry = route.geometry;

		await expect(route.refineRoute()).resolves.toEqual({
			ok: false,
			error: 'No route found.'
		});
		expect(route.status).toBe('ready');
		expect(route.geometry).toEqual(previousGeometry);
		expect(route.isWaypointDetour(1)).toBe(true);
		expect(route.hasRefinedRoute).toBe(false);
		expect(route.errorMessage).toBe('No route found.');
	});

	it('resets a refined route from sketch-prepared waypoints', async () => {
		requestRouteMock
			.mockResolvedValueOnce(detourSuccess)
			.mockResolvedValueOnce(success)
			.mockResolvedValueOnce(detourSuccess);
		await route.generate([line], 35);
		await route.refineRoute();
		expect(route.hasRefinedRoute).toBe(true);

		await route.resetFromSketch([line], 35);
		const resetVias = requestRouteMock.mock.calls[2]![0];
		expect(resetVias.length).toBeGreaterThan(2);
		expect(resetVias[0]).toEqual([21, 52]);
		expect(resetVias.at(-1)).toEqual([21.01, 52.01]);
		expect(route.hasRefinedRoute).toBe(false);
	});

	it('preserves a refined route when reset fails', async () => {
		requestRouteMock
			.mockResolvedValueOnce(detourSuccess)
			.mockResolvedValueOnce(success)
			.mockResolvedValueOnce({ ok: false, error: 'Reset failed.' });
		await route.generate([line], 38);
		await route.refineRoute();
		const refinedGeometry = route.geometry;

		await expect(route.resetFromSketch([line], 38)).resolves.toEqual({
			ok: false,
			error: 'Reset failed.'
		});
		expect(route.status).toBe('ready');
		expect(route.geometry).toEqual(refinedGeometry);
		expect(route.hasRefinedRoute).toBe(true);
		expect(route.errorMessage).toBe('Reset failed.');
	});

	it('keeps geometry while refining and ignores the result after sketch invalidation', async () => {
		let resolveRoute!: (value: typeof success) => void;
		requestRouteMock.mockResolvedValueOnce(detourSuccess).mockReturnValueOnce(
			new Promise<typeof success>((resolve) => {
				resolveRoute = resolve;
			})
		);
		await route.generate([line], 36);
		const previousGeometry = route.geometry;

		const pending = route.refineRoute();
		expect(route.loadingAction).toBe('refine');
		expect(route.geometry).toEqual(previousGeometry);
		route.syncSketch(37);
		resolveRoute(success);

		await expect(pending).resolves.toEqual({ ok: false, error: 'Superseded.' });
		expect(route.status).toBe('idle');
		expect(route.geometry).toBeNull();
	});

	it('resets manual overrides on reroute, clear, invalidation, and error', async () => {
		requestRouteMock.mockResolvedValue(ordinarySuccess);
		await route.generate([line], 23);
		route.toggleDetourWaypoint(1);
		expect(route.isWaypointDetour(1)).toBe(true);

		await route.generate([line], 23);
		expect(route.isWaypointDetour(1)).toBe(false);
		route.toggleDetourWaypoint(1);
		route.clear();
		expect(route.isWaypointDetour(1)).toBe(false);

		await route.generate([line], 24);
		route.toggleDetourWaypoint(1);
		route.syncSketch(25);
		expect(route.isWaypointDetour(1)).toBe(false);

		await route.generate([line], 26);
		route.toggleDetourWaypoint(1);
		await route.generate([], 27);
		expect(route.isWaypointDetour(1)).toBe(false);
	});

	it('invalidates a ready route when the drawing revision changes', async () => {
		requestRouteMock.mockResolvedValue(success);

		await route.generate([line], 4);
		expect(route.isReady).toBe(true);

		route.syncSketch(5);
		expect(route.status).toBe('idle');
		expect(route.geometry).toBeNull();
		expect(route.waypoints).toEqual([]);
		expect(route.detours).toEqual([]);
	});

	it('ignores an in-flight result after the drawing revision changes', async () => {
		let resolveRoute!: (value: typeof success) => void;
		requestRouteMock.mockReturnValue(
			new Promise<typeof success>((resolve) => {
				resolveRoute = resolve;
			})
		);

		const pending = route.generate([line], 7);
		expect(route.status).toBe('loading');
		expect(route.waypoints.length).toBeGreaterThan(2);
		expect(route.waypoints[0]).toEqual([21, 52]);
		expect(route.waypoints[route.waypoints.length - 1]).toEqual([21.01, 52.01]);

		route.syncSketch(8);
		resolveRoute(success);

		await expect(pending).resolves.toEqual({ ok: false, error: 'Superseded.' });
		expect(route.status).toBe('idle');
		expect(route.geometry).toBeNull();
	});

	it('clears an error when the drawing revision changes', async () => {
		await expect(route.generate([], 11)).resolves.toEqual({
			ok: false,
			error: 'Sketch a shape first.'
		});
		expect(route.status).toBe('error');

		route.syncSketch(12);
		expect(route.status).toBe('idle');
		expect(route.errorMessage).toBeNull();
	});
});
