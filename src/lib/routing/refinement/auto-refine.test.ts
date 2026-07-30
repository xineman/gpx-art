import { describe, expect, it, vi } from 'vitest';
import type { RouteSuccess } from '../matching/types';
import { refineRouteAutomatically } from './auto-refine';

const routeWithDetour: RouteSuccess = {
	ok: true,
	geometry: {
		type: 'LineString',
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

const improvedRoute: RouteSuccess = {
	ok: true,
	geometry: {
		type: 'LineString',
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

describe('automatic route refinement', () => {
	it('accepts an improvement and returns the best route', async () => {
		const request = vi.fn().mockResolvedValue(improvedRoute);

		const outcome = await refineRouteAutomatically(routeWithDetour, request);

		expect(request).toHaveBeenCalledOnce();
		expect(outcome).toEqual({
			response: improvedRoute,
			route: improvedRoute,
			refined: true
		});
	});

	it('keeps the previous route when a response makes the route much longer', async () => {
		const longerRoute: RouteSuccess = {
			...improvedRoute,
			distanceM: 1_300
		};
		const request = vi.fn().mockResolvedValue(longerRoute);

		const outcome = await refineRouteAutomatically(routeWithDetour, request);

		expect(outcome).toEqual({
			response: routeWithDetour,
			route: routeWithDetour,
			refined: false
		});
	});

	it('returns a request failure together with the last accepted route', async () => {
		const failure = { ok: false as const, error: 'No route found.' };
		const request = vi.fn().mockResolvedValue(failure);

		const outcome = await refineRouteAutomatically(routeWithDetour, request);

		expect(outcome).toEqual({
			response: failure,
			route: routeWithDetour,
			refined: false
		});
	});
});
