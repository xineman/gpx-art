import { describe, expect, it, vi } from 'vitest';
import type { RouteRequest, RouteSuccess } from '../api/contracts';
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

it('continues from newly snapped waypoints when original vias repeat the previous request', async () => {
	const a = [21, 52];
	const junction = [21.001, 52];
	const tip = [21.001, 52.001];
	const b = [21.003, 52];
	const snappedStart = [21.0001, 52];
	const shorterTip = [21.001, 52.0005];
	const sourceStart = { location: [21, 52.0001], radiusM: 80 };
	const sourceEnd = { location: b, bearing: 90, bearingRange: 30 };
	const movedVia = { location: junction, radiusM: 20, bearing: 90, bearingRange: 45 };
	const initial: RouteSuccess = {
		ok: true,
		geometry: { type: 'LineString', coordinates: [a, junction, tip, junction, b] },
		waypoints: [a, tip, b],
		sourceVias: [sourceStart, { location: tip }, sourceEnd],
		distanceM: 430
	};
	const intermediate: RouteSuccess = {
		ok: true,
		geometry: {
			type: 'LineString',
			coordinates: [snappedStart, junction, shorterTip, junction, b]
		},
		waypoints: [snappedStart, shorterTip, b],
		distanceM: 310
	};
	const request = vi
		.fn<(request: RouteRequest) => Promise<RouteSuccess>>()
		.mockImplementationOnce(async ({ vias }) => ({ ...intermediate, sourceVias: vias }))
		.mockResolvedValueOnce(improvedRoute);
	const outcome = await refineRouteAutomatically(initial, request);

	expect(request.mock.calls).toEqual([
		[{ vias: [sourceStart, movedVia, sourceEnd] }],
		[{ vias: [{ location: snappedStart }, movedVia, { location: b }] }]
	]);
	expect(outcome.route).toBe(improvedRoute);
	expect(outcome.refined).toBe(true);
});

it.each([
	{ name: 'accepts the reroute after removing a newly introduced spur', cleaned: true },
	{ name: 'keeps the accepted route when a newly introduced spur persists', cleaned: false }
])('$name', async ({ cleaned }) => {
	const a = [21, 52];
	const firstJunction = [21.001, 52];
	const firstTip = [21.001, 52.002];
	const secondJunction = [21.002, 52];
	const secondTip = [21.002, 52.0004];
	const b = [21.003, 52];
	const initial: RouteSuccess = {
		ok: true,
		geometry: {
			type: 'LineString',
			coordinates: [a, firstJunction, firstTip, firstJunction, secondJunction, b]
		},
		waypoints: [a, firstTip, b],
		distanceM: 650
	};
	const trial: RouteSuccess = {
		ok: true,
		geometry: {
			type: 'LineString',
			coordinates: [a, firstJunction, secondJunction, secondTip, secondJunction, b]
		},
		waypoints: [a, secondTip, b],
		distanceM: 295
	};
	const request = vi
		.fn()
		.mockResolvedValueOnce(trial)
		.mockResolvedValueOnce(cleaned ? improvedRoute : trial);
	const outcome = await refineRouteAutomatically(initial, request);

	expect(request).toHaveBeenCalledTimes(2);
	expect(request.mock.calls[1]![0].vias[1].location).toEqual(secondJunction);
	expect(outcome.route).toBe(cleaned ? improvedRoute : initial);
	expect(outcome.refined).toBe(cleaned);
});
