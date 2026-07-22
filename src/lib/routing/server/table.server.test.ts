import { describe, expect, it } from 'vitest';
import { MAX_VIAS } from '$lib/config/routing';
import { parseTableRequest } from './table.server';

describe('parseTableRequest', () => {
	it('accepts coordinates without reordering or deduplicating them', () => {
		const coordinates = [
			[21, 52],
			[21, 52],
			[21.01, 52.01]
		];
		expect(parseTableRequest({ coordinates })).toEqual({
			ok: true,
			request: { coordinates }
		});
	});

	it('requires between two and the route-wide maximum coordinates', () => {
		expect(parseTableRequest({ coordinates: [[21, 52]] })).toMatchObject({ ok: false });
		expect(
			parseTableRequest({
				coordinates: Array.from({ length: MAX_VIAS + 1 }, (_, index) => [index, 0])
			})
		).toMatchObject({ ok: false, error: expect.stringMatching(/max 60/i) });
	});

	it.each([
		[
			'non-finite',
			[
				[21, 52],
				[Number.NaN, 52]
			],
			/valid/i
		],
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
	])('rejects %s coordinates', (_, coordinates, error) => {
		expect(parseTableRequest({ coordinates })).toMatchObject({
			ok: false,
			error: expect.stringMatching(error as RegExp)
		});
	});
});
