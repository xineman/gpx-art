import { describe, expect, it, vi } from 'vitest';
import type { Position } from 'geojson';
import {
	buildValhallaMatrixBody,
	buildValhallaMatrixUrl,
	fetchValhallaDistanceMatrix
} from './valhalla-matrix.server';

const coordinates: Position[] = [
	[21, 52],
	[21.01, 52.01]
];

describe('Valhalla distance matrix', () => {
	it('builds one directed bicycle matrix containing every endpoint as source and target', () => {
		expect(buildValhallaMatrixUrl('https://example.test/')).toBe(
			'https://example.test/sources_to_targets'
		);
		expect(buildValhallaMatrixBody(coordinates)).toEqual({
			sources: [
				{ lat: 52, lon: 21 },
				{ lat: 52.01, lon: 21.01 }
			],
			targets: [
				{ lat: 52, lon: 21 },
				{ lat: 52.01, lon: 21.01 }
			],
			costing: 'bicycle',
			units: 'kilometers',
			verbose: false
		});
	});

	it('parses kilometer distances as meters and preserves unreachable cells', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({
				sources_to_targets: {
					distances: [
						[0, 1.25],
						[null, 0]
					]
				}
			})
		);

		const result = await fetchValhallaDistanceMatrix(coordinates, {
			baseUrl: 'https://example.test/',
			userAgent: 'test',
			fetchFn: fetchFn as unknown as typeof fetch
		});

		expect(result).toEqual({
			ok: true,
			distances: [
				[0, 1_250],
				[null, 0]
			]
		});
		expect(fetchFn).toHaveBeenCalledWith(
			'https://example.test/sources_to_targets',
			expect.objectContaining({ method: 'POST' })
		);
	});

	it('returns the upstream failure without inventing an aerial fallback', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({ error: 'No path could be found', status_code: 400 }, { status: 400 })
		);
		const result = await fetchValhallaDistanceMatrix(coordinates, {
			baseUrl: 'https://example.test',
			userAgent: 'test',
			fetchFn: fetchFn as unknown as typeof fetch
		});

		expect(result).toEqual({
			ok: false,
			error: 'Couldn’t optimize shape order — No path could be found.',
			status: 400
		});
	});

	it('rejects a malformed matrix', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({ sources_to_targets: { distances: [[0, 1]] } })
		);
		const result = await fetchValhallaDistanceMatrix(coordinates, {
			baseUrl: 'https://example.test',
			userAgent: 'test',
			fetchFn: fetchFn as unknown as typeof fetch
		});

		expect(result).toEqual({
			ok: false,
			error: 'Couldn’t optimize shape order — invalid routing response.',
			status: 502
		});
	});
});
