import { describe, expect, it } from 'vitest';
import { MAX_VIAS } from '#lib/config/routing.js';
import { jsonPostRequest } from '../request.test-helper';
import { readBody } from './contract.server';

function readJson(body: unknown) {
	return readBody(jsonPostRequest(body));
}

describe('request validation', () => {
	it('accepts coordinates without reordering or deduplicating them', async () => {
		const coordinates = [
			[21, 52],
			[21, 52],
			[21.01, 52.01]
		];
		expect(await readJson({ coordinates })).toEqual({
			ok: true,
			data: { coordinates }
		});
	});

	it('canonicalizes positions and strips unknown request fields', async () => {
		expect(
			await readJson({
				coordinates: [
					[21, 52, 100],
					[21.01, 52.01, 'ignored']
				],
				ignored: true
			})
		).toEqual({
			ok: true,
			data: {
				coordinates: [
					[21, 52],
					[21.01, 52.01]
				]
			}
		});
	});

	it('requires between two and the route-wide maximum coordinates', async () => {
		expect(await readJson({ coordinates: [[21, 52]] })).toMatchObject({ ok: false });
		expect(
			await readJson({
				coordinates: Array.from({ length: MAX_VIAS + 1 }, (_, index) => [index, 0])
			})
		).toMatchObject({ ok: false, error: expect.stringMatching(/max 60/i) });
	});

	it('rejects coordinates that overflow when decoded from JSON', async () => {
		const request = new Request('http://localhost', {
			method: 'POST',
			body: '{"coordinates":[[21,52],[1e400,52]]}'
		});
		expect(await readBody(request)).toEqual({
			ok: false,
			error: 'Coordinate 1 is not a valid [lng, lat].'
		});
	});

	it.each([
		[
			'longitude out of range',
			[
				[21, 52],
				[181, 52]
			],
			/range/i
		],
		[
			'latitude out of range',
			[
				[21, 52],
				[21, -91]
			],
			/range/i
		]
	])('rejects %s coordinates', async (_, coordinates, error) => {
		expect(await readJson({ coordinates })).toMatchObject({
			ok: false,
			error: expect.stringMatching(error as RegExp)
		});
	});
});
