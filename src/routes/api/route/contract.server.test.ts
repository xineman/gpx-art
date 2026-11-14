import { describe, expect, it } from 'vitest';
import type { Position } from 'geojson';
import { jsonPostRequest } from '../request.test-helper';
import { readBody } from './contract.server';

function routeRequest(locations: Position[]) {
	return { vias: locations.map((location) => ({ location })) };
}

function readJson(body: unknown) {
	return readBody(jsonPostRequest(body));
}

describe('request validation', () => {
	it('accepts a minimal valid route', async () => {
		expect(
			await readJson(
				routeRequest([
					[21, 52],
					[21.01, 52.01]
				])
			)
		).toEqual({
			ok: true,
			data: routeRequest([
				[21, 52],
				[21.01, 52.01]
			])
		});
	});

	it('canonicalizes positions and strips unknown waypoint fields', async () => {
		expect(
			await readJson({
				vias: [{ location: [21, 52, 100], ignored: true }, { location: [21.01, 52.01, 'ignored'] }],
				ignored: true
			})
		).toEqual({
			ok: true,
			data: {
				vias: [{ location: [21, 52] }, { location: [21.01, 52.01] }]
			}
		});
	});

	it('rejects empty vias', async () => {
		const result = await readJson({ vias: [] });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/at least 2/i);
	});

	it('rejects too few vias', async () => {
		const result = await readJson(routeRequest([[21, 52]]));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/at least 2/i);
	});

	it('rejects non-finite coords', async () => {
		const request = new Request('http://localhost', {
			method: 'POST',
			body: '{"vias":[{"location":[21,52]},{"location":[1e400,52]}]}'
		});
		const result = await readBody(request);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/valid/i);
	});

	it('rejects out-of-range coords', async () => {
		const result = await readJson(
			routeRequest([
				[21, 52],
				[200, 52]
			])
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/range/i);
	});

	it.each([
		['radius', { radiusM: -1 }, /radius/i],
		['bearing', { bearing: 45.5 }, /bearing/i],
		['bearing range', { bearing: 45, bearingRange: 181 }, /bearing range/i],
		['orphan bearing range', { bearingRange: 45 }, /bearing range/i]
	])('rejects an invalid %s', async (_, constraint, expectedError) => {
		const result = await readJson({
			vias: [{ location: [21, 52], ...constraint }, { location: [21.01, 52.01] }]
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(expectedError as RegExp);
	});

	it('deduplicates consecutive vias', async () => {
		const result = await readJson({
			vias: [{ location: [21, 52] }, { location: [21, 52] }, { location: [21.01, 52.01] }]
		});
		expect(result).toEqual({
			ok: true,
			data: {
				vias: [{ location: [21, 52] }, { location: [21.01, 52.01] }]
			}
		});
	});

	it('rejects the former grouped-shapes payload', async () => {
		expect(await readJson({ shapes: [] })).toMatchObject({
			ok: false,
			error: expect.stringMatching(/vias array/i)
		});
	});
});
