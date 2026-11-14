import { describe, expect, it } from 'vitest';
import { jsonPostRequest } from '../request.test-helper';
import { readBody } from './contract.server';

function readJson(body: unknown) {
	return readBody(jsonPostRequest(body));
}

describe('request validation', () => {
	it('copies a valid canonical LineString', async () => {
		const geometry = {
			type: 'LineString',
			coordinates: [
				[21, 52],
				[21.01, 52.01]
			]
		};
		expect(await readJson({ geometry })).toEqual({ ok: true, data: { geometry } });
	});

	it('preserves valid elevation and rejects invalid extra position elements', async () => {
		const geometry = {
			type: 'LineString',
			coordinates: [
				[21, 52, 100],
				[21.01, 52.01, 110]
			]
		};
		expect(await readJson({ geometry })).toEqual({ ok: true, data: { geometry } });
		expect(
			await readJson({
				geometry: {
					...geometry,
					coordinates: [
						[21, 52, 100],
						[21.01, 52.01, 'invalid']
					]
				}
			})
		).toMatchObject({ ok: false, error: expect.stringMatching(/coordinate/i) });
	});

	it.each([
		[{}, /include/i],
		[{ geometry: { type: 'Point', coordinates: [21, 52] } }, /linestring/i],
		[{ geometry: { type: 'LineString', coordinates: [[21, 52]] } }, /number of points/i],
		[
			{
				geometry: {
					type: 'LineString',
					coordinates: [
						[21, 52],
						[181, 52]
					]
				}
			},
			/coordinate/i
		]
	])('rejects invalid attribution input %#', async (body, expected) => {
		expect(await readJson(body)).toEqual(
			expect.objectContaining({ ok: false, error: expect.stringMatching(expected as RegExp) })
		);
	});
});
