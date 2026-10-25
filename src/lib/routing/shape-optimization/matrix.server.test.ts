import { describe, expect, it } from 'vitest';
import { MAX_VIAS } from '#lib/config/routing.js';
import { parseMatrixRequest } from './matrix.server';

describe('parseMatrixRequest', () => {
	it('accepts coordinates without reordering or deduplicating them', () => {
		const coordinates = [
			[21, 52],
			[21, 52],
			[21.01, 52.01]
		];
		expect(parseMatrixRequest({ coordinates })).toEqual({
			ok: true,
			request: { coordinates }
		});
	});

	it('canonicalizes positions and strips unknown request fields', () => {
		expect(
			parseMatrixRequest({
				coordinates: [
					[21, 52, 100],
					[21.01, 52.01, 'ignored']
				],
				ignored: true
			})
		).toEqual({
			ok: true,
			request: {
				coordinates: [
					[21, 52],
					[21.01, 52.01]
				]
			}
		});
	});

	it('requires between two and the route-wide maximum coordinates', () => {
		expect(parseMatrixRequest({ coordinates: [[21, 52]] })).toMatchObject({ ok: false });
		expect(
			parseMatrixRequest({
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
		expect(parseMatrixRequest({ coordinates })).toMatchObject({
			ok: false,
			error: expect.stringMatching(error as RegExp)
		});
	});
});
