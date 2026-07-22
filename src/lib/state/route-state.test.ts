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

function featuresOfKind(kind: string) {
	return route.collection.features.filter((feature) => feature.properties?.kind === kind);
}

function routeGeometry() {
	return featuresOfKind('route')[0]?.geometry;
}

function waypointCoordinates() {
	return featuresOfKind('waypoint').map((feature) => {
		if (feature.geometry.type !== 'Point') throw new Error('Expected a waypoint point feature.');
		return feature.geometry.coordinates;
	});
}

function waypointProperties(index: number) {
	return featuresOfKind('waypoint').find((feature) => feature.properties?.index === index)
		?.properties;
}

afterEach(() => {
	route.syncSketch(Number.MIN_SAFE_INTEGER);
	requestRouteMock.mockReset();
});

describe('route state', () => {
	it('automatically refines a freshly generated route when requested', async () => {
		requestRouteMock.mockResolvedValueOnce(ordinarySuccess).mockResolvedValueOnce(straightSuccess);

		await route.generate([line], 2, { autoRefine: true });

		expect(requestRouteMock).toHaveBeenCalledTimes(2);
		expect(routeGeometry()).toEqual(straightSuccess.geometry);
		expect(route.hasRefinedRoute).toBe(true);
	});

	it('returns an automatic-refinement failure while preserving the initial route', async () => {
		requestRouteMock
			.mockResolvedValueOnce(ordinarySuccess)
			.mockResolvedValueOnce({ ok: false, error: 'No route found.' });

		const result = await route.generate([line], 2, { autoRefine: true });

		expect(result).toEqual({ ok: false, error: 'No route found.' });
		expect(route.status).toBe('ready');
		expect(routeGeometry()).toEqual(ordinarySuccess.geometry);
		expect(route.hasRefinedRoute).toBe(false);
	});

	it('keeps explicit refinement loading until its single request settles', async () => {
		let resolveRefinement!: (result: typeof straightSuccess) => void;
		const refinementResponse = new Promise<typeof straightSuccess>((resolve) => {
			resolveRefinement = resolve;
		});
		requestRouteMock.mockResolvedValueOnce(ordinarySuccess).mockReturnValueOnce(refinementResponse);

		await route.generate([line], 16);
		const refinement = route.refineRoute();
		expect(route.status).toBe('loading');
		expect(route.loadingAction).toBe('refine');

		resolveRefinement(straightSuccess);
		await refinement;
		expect(route.status).toBe('ready');
		expect(route.loadingAction).toBeNull();
	});

	it('reports a failed explicit refinement and preserves the current route', async () => {
		requestRouteMock
			.mockResolvedValueOnce(ordinarySuccess)
			.mockResolvedValueOnce({ ok: false, error: 'No route found.' });

		await route.generate([line], 17);
		const result = await route.refineRoute();

		expect(result).toEqual({ ok: false, error: 'No route found.' });
		expect(route.status).toBe('ready');
		expect(routeGeometry()).toEqual(ordinarySuccess.geometry);
		expect(route.hasRefinedRoute).toBe(false);
	});

	it('keeps an explicit successful result even when it is longer and snaps to the same vias', async () => {
		const longerSameViaSuccess = {
			...success,
			waypoints: ordinarySuccess.waypoints
		};
		requestRouteMock
			.mockResolvedValueOnce(ordinarySuccess)
			.mockResolvedValueOnce(longerSameViaSuccess);

		await route.generate([line], 18);
		const result = await route.refineRoute();

		expect(result).toEqual(longerSameViaSuccess);
		expect(requestRouteMock).toHaveBeenCalledTimes(2);
		expect(routeGeometry()).toEqual(longerSameViaSuccess.geometry);
		expect(waypointCoordinates()).toEqual(ordinarySuccess.waypoints);
		expect(route.distanceLabel).toBe('1.3 km');
		expect(route.hasRefinedRoute).toBe(true);
	});

	it('restores the prior route when automatic refinement makes it much longer', async () => {
		requestRouteMock.mockResolvedValueOnce(ordinarySuccess).mockResolvedValueOnce(success);

		await route.generate([line], 2, { autoRefine: true });

		expect(requestRouteMock).toHaveBeenCalledTimes(2);
		expect(routeGeometry()).toEqual(ordinarySuccess.geometry);
		expect(route.distanceLabel).toBe('350 m');
		expect(route.hasRefinedRoute).toBe(false);
	});

	it('marks a detected candidate as a move suggestion without changing route geometry', async () => {
		requestRouteMock.mockResolvedValue(ordinarySuccess);

		await route.generate([line], 3);

		expect(routeGeometry()).toEqual(ordinarySuccess.geometry);
		expect(waypointProperties(1)).toMatchObject({ candidate: true, action: 'move' });
		expect(route.moveWaypointCount).toBe(1);
		expect(route.removeWaypointCount).toBe(0);
		expect(route.pendingWaypointCount).toBe(1);
		expect(featuresOfKind('detour')).toHaveLength(1);
		expect(waypointProperties(1)).toMatchObject({ candidate: true, action: 'move' });
		expect(featuresOfKind('detour')[0]?.geometry).toBeDefined();
	});

	it('cycles a detected candidate through move, remove, and keep', async () => {
		requestRouteMock.mockResolvedValue(ordinarySuccess);
		await route.generate([line], 4);

		expect(route.cycleWaypointAction(1)).toBe('remove');
		expect(waypointProperties(1)?.action).toBe('remove');
		expect(route.moveWaypointCount).toBe(0);
		expect(route.removeWaypointCount).toBe(1);
		expect(featuresOfKind('detour')).toHaveLength(0);

		expect(route.cycleWaypointAction(1)).toBe('keep');
		expect(waypointProperties(1)?.action).toBe('keep');
		expect(route.pendingWaypointCount).toBe(0);
		expect(waypointProperties(1)).toMatchObject({ candidate: true, action: 'keep' });

		expect(route.cycleWaypointAction(1)).toBe('move');
		expect(waypointProperties(1)?.action).toBe('move');
		expect(featuresOfKind('detour')).toHaveLength(1);
	});

	it('cycles ordinary waypoints between keep and remove, including endpoints', async () => {
		requestRouteMock.mockResolvedValueOnce(straightSuccess).mockResolvedValueOnce(success);
		await route.generate([line], 5);

		expect(waypointProperties(1)).toMatchObject({ candidate: false, action: 'keep' });
		expect(route.cycleWaypointAction(1)).toBe('remove');
		expect(route.cycleWaypointAction(0)).toBe('remove');
		expect(route.canRefineRoute).toBe(false);

		expect(route.cycleWaypointAction(0)).toBe('keep');
		expect(route.canRefineRoute).toBe(true);
		await route.refineRoute();
		expect(requestRouteMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				vias: [
					expect.objectContaining({ location: straightSuccess.waypoints[0] }),
					expect.objectContaining({ location: straightSuccess.waypoints[2] })
				]
			})
		);
	});

	it('moves a candidate to its detected detour entry during refinement', async () => {
		requestRouteMock.mockResolvedValueOnce(ordinarySuccess).mockResolvedValueOnce(success);
		await route.generate([line], 6);

		expect(route.canRefineRoute).toBe(true);
		await route.refineRoute();
		expect(requestRouteMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				vias: expect.arrayContaining([
					expect.objectContaining({ location: ordinarySuccess.waypoints[0] }),
					expect.objectContaining({ location: [21.001, 52], radiusM: 20 }),
					expect.objectContaining({ location: ordinarySuccess.waypoints[2] })
				])
			})
		);
	});

	it('combines a move candidate with a removed ordinary waypoint', async () => {
		requestRouteMock.mockResolvedValueOnce(mixedSuccess).mockResolvedValueOnce(success);
		await route.generate([line], 7);

		expect(waypointProperties(1)?.action).toBe('move');
		expect(waypointProperties(2)?.candidate).toBe(false);
		expect(route.cycleWaypointAction(2)).toBe('remove');
		expect(route.moveWaypointCount).toBe(1);
		expect(route.removeWaypointCount).toBe(1);
		await route.refineRoute();
		expect(requestRouteMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				vias: [
					expect.objectContaining({ location: mixedSuccess.waypoints[0] }),
					expect.objectContaining({ location: [21.002, 52], radiusM: 20 }),
					expect.objectContaining({ location: mixedSuccess.waypoints[3] })
				]
			})
		);
	});

	it('keeps an explicit detour override after another waypoint is refined', async () => {
		requestRouteMock.mockResolvedValueOnce(mixedSuccess).mockResolvedValueOnce(ordinarySuccess);
		await route.generate([line], 7);

		// A candidate starts as move; cycling twice explicitly opts it out of refinement.
		expect(route.cycleWaypointAction(1)).toBe('remove');
		expect(route.cycleWaypointAction(1)).toBe('keep');
		expect(route.cycleWaypointAction(2)).toBe('remove');

		await route.refineRoute();

		expect(waypointProperties(1)).toMatchObject({ candidate: true, action: 'keep' });
		expect(route.moveWaypointCount).toBe(0);
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
		await expect(route.refineRoute()).resolves.toEqual({
			ok: false,
			error: 'Keep at least 2 waypoints to refine the route.'
		});
	});

	it('resets selected actions on reroute, invalidation, and a fresh-route error', async () => {
		requestRouteMock.mockResolvedValue(ordinarySuccess);
		await route.generate([line], 9);
		route.cycleWaypointAction(1);
		expect(waypointProperties(1)?.action).toBe('remove');

		await route.generate([line], 9);
		expect(waypointProperties(1)?.action).toBe('move');
		route.cycleWaypointAction(1);
		route.syncSketch(10);
		expect(waypointProperties(1)).toBeUndefined();

		await route.generate([line], 10);
		route.cycleWaypointAction(1);
		requestRouteMock.mockResolvedValueOnce({ ok: false, error: 'No route found.' });
		await expect(route.generate([line], 11)).resolves.toEqual({
			ok: false,
			error: 'No route found.'
		});
		expect(waypointProperties(1)?.action).toBe('keep');

		await route.generate([line], 12);
		route.cycleWaypointAction(1);
		route.syncSketch(13);
		expect(waypointProperties(1)).toBeUndefined();
	});

	it('resets selected actions when restoring the route from the sketch', async () => {
		requestRouteMock
			.mockResolvedValueOnce(ordinarySuccess)
			.mockResolvedValueOnce(straightSuccess)
			.mockResolvedValueOnce(ordinarySuccess);
		await route.generate([line], 15);
		await route.refineRoute();
		expect(route.hasRefinedRoute).toBe(true);

		expect(route.cycleWaypointAction(0)).toBe('remove');
		expect(route.removeWaypointCount).toBe(1);
		await route.resetFromSketch([line], 15);
		expect(route.hasRefinedRoute).toBe(false);
		expect(route.removeWaypointCount).toBe(0);
		expect(waypointProperties(1)?.action).toBe('move');
	});

	it('preserves the selected actions when a refinement request fails', async () => {
		requestRouteMock
			.mockResolvedValueOnce(ordinarySuccess)
			.mockResolvedValueOnce({ ok: false, error: 'No route found.' });
		await route.generate([line], 14);
		route.cycleWaypointAction(1);

		await expect(route.refineRoute()).resolves.toEqual({ ok: false, error: 'No route found.' });
		expect(route.status).toBe('ready');
		expect(waypointProperties(1)?.action).toBe('remove');
	});
});
