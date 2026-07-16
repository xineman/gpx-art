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
	distanceM: 1_300
};

afterEach(() => {
	route.clear();
	requestRouteMock.mockReset();
});

describe('route state', () => {
	it('invalidates a ready route when the drawing revision changes', async () => {
		requestRouteMock.mockResolvedValue(success);

		await route.generate([line], 4);
		expect(route.isReady).toBe(true);

		route.syncSketch(5);
		expect(route.status).toBe('idle');
		expect(route.geometry).toBeNull();
		expect(route.waypoints).toEqual([]);
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
