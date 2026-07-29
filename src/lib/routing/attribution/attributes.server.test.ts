import { describe, expect, it } from 'vitest';
import { parseRouteGeometry } from './attributes.server';

describe('parseRouteGeometry', () => {
	it('copies a valid canonical LineString', () => {
		const geometry = {
			type: 'LineString',
			coordinates: [
				[21, 52],
				[21.01, 52.01]
			]
		};
		expect(parseRouteGeometry({ geometry })).toEqual({ ok: true, geometry });
	});

	it('preserves valid elevation and rejects invalid extra position elements', () => {
		const geometry = {
			type: 'LineString',
			coordinates: [
				[21, 52, 100],
				[21.01, 52.01, 110]
			]
		};
		expect(parseRouteGeometry({ geometry })).toEqual({ ok: true, geometry });
		expect(
			parseRouteGeometry({
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
	])('rejects invalid attribution input %#', (body, expected) => {
		expect(parseRouteGeometry(body)).toEqual(
			expect.objectContaining({ ok: false, error: expect.stringMatching(expected as RegExp) })
		);
	});
});
