import { describe, expect, it, vi } from 'vitest';
import type { Position } from 'geojson';
import type { AttributedRouteEdge } from '../../attribution/types';
import { encodePolyline6 } from './polyline';
import { buildRoadSpans, fetchValhallaAttributes, parsePolishRoadNames } from './attributes.server';

function edge(overrides: Partial<AttributedRouteEdge> = {}): AttributedRouteEdge {
	return {
		id: '1',
		wayId: 10,
		refs: ['DK10'],
		ref: 'DK10',
		displayLabel: 'DK10',
		name: 'Bydgoska',
		roadKind: 'national',
		roadClass: 'primary',
		use: 'road',
		surface: 'paved',
		cycleLane: 'none',
		bicycleNetwork: 0,
		weightedGrade: 1,
		maxUpwardGrade: 2,
		maxDownwardGrade: -2,
		meanElevationM: 100,
		start: [18, 52],
		end: [18.01, 52.01],
		startM: 0,
		endM: 600,
		distanceM: 600,
		startShapeIndex: 0,
		endShapeIndex: 1,
		...overrides
	};
}

describe('parsePolishRoadNames', () => {
	it.each([
		[['Poznańska', '92'], 'DK92', 'Poznańska', 'national'],
		[['Fabryczna', '700'], 'DW700', 'Fabryczna', 'voivodeship'],
		[['A2'], 'A2', null, 'national'],
		[['S8'], 'S8', null, 'national'],
		[['DK10'], 'DK10', null, 'national'],
		[['DW296'], 'DW296', null, 'voivodeship'],
		[['1234'], null, '1234', 'other']
	])('extracts Polish refs from %j', (names, ref, name, roadKind) => {
		expect(parsePolishRoadNames(names)).toMatchObject({ ref, name, roadKind });
	});

	it('keeps international refs secondary to the Polish road ref', () => {
		expect(parsePolishRoadNames(['E30', '2', 'Aleja Europejska'])).toEqual({
			refs: ['DK2', 'E30'],
			ref: 'DK2',
			name: 'Aleja Europejska',
			roadKind: 'national',
			displayLabel: 'DK2 · E30'
		});
	});
});

describe('buildRoadSpans', () => {
	it('merges only consecutive matching roads and preserves their exact route range', () => {
		const spans = buildRoadSpans([
			edge(),
			edge({
				id: '2',
				wayId: 11,
				start: [18.01, 52.01],
				end: [18.02, 52.02],
				startM: 600,
				endM: 1000,
				distanceM: 400,
				startShapeIndex: 1,
				endShapeIndex: 2
			}),
			edge({
				id: '3',
				wayId: 20,
				refs: ['DW296'],
				ref: 'DW296',
				displayLabel: 'DW296',
				roadKind: 'voivodeship',
				start: [18.02, 52.02],
				end: [18.03, 52.03],
				startM: 1000,
				endM: 1500,
				distanceM: 500,
				startShapeIndex: 2,
				endShapeIndex: 3
			})
		]);

		expect(spans).toHaveLength(2);
		expect(spans[0]).toMatchObject({
			ref: 'DK10',
			wayIds: [10, 11],
			start: [18, 52],
			end: [18.02, 52.02],
			startM: 0,
			endM: 1000,
			distanceM: 1000,
			startShapeIndex: 0,
			endShapeIndex: 2
		});
	});

	it('uses names without refs and groups compatible unnamed streets for display', () => {
		const nameOnly = edge({ refs: [], ref: null, name: 'Leśna', roadKind: 'other' });
		const unnamed = edge({ refs: [], ref: null, name: null, roadKind: 'other', wayId: 99 });
		expect(buildRoadSpans([nameOnly, { ...nameOnly, wayId: 12 }])).toHaveLength(1);
		expect(buildRoadSpans([unnamed, { ...unnamed }, { ...unnamed, wayId: 100 }])).toEqual([
			expect.objectContaining({
				displayLabel: 'Local streets',
				wayIds: [99, 100],
				distanceM: 600
			})
		]);
		expect(
			buildRoadSpans([unnamed, { ...unnamed, wayId: 100, roadClass: 'service' }])
		).toHaveLength(2);
	});

	it('keeps bike-facility changes as distinct spans', () => {
		const road = edge({ refs: [], ref: null, name: 'Leśna', roadKind: 'other' });
		expect(
			buildRoadSpans([
				road,
				{ ...road, id: '2', cycleLane: 'separated' },
				{ ...road, id: '3', use: 'cycleway', cycleLane: 'separated' }
			])
		).toHaveLength(3);
	});
});

describe('fetchValhallaAttributes', () => {
	it('attributes an accepted route without calling Valhalla /route', async () => {
		const points: Position[] = [
			[21, 52],
			[21.01, 52.01]
		];
		const shape = encodePolyline6(points);
		const fetchFn = vi.fn().mockResolvedValueOnce(
			Response.json({
				shape,
				edges: [
					{
						way_id: 99,
						length: 0.75,
						begin_shape_index: 0,
						end_shape_index: 1,
						names: ['DK10']
					}
				]
			})
		);

		const result = await fetchValhallaAttributes(
			{ type: 'LineString', coordinates: points },
			{
				baseUrl: 'https://valhalla.test',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(String(fetchFn.mock.calls[0]![0])).toBe('https://valhalla.test/trace_attributes');
		expect(JSON.parse(String(fetchFn.mock.calls[0]![1]?.body))).toMatchObject({
			shape_match: 'edge_walk',
			costing: 'bicycle'
		});
		expect(result).toMatchObject({
			ok: true,
			distanceM: 750,
			roadSpans: [{ ref: 'DK10', wayId: 99 }]
		});
	});

	it('falls back to map matching only when the exact edge walk fails', async () => {
		const points: Position[] = [
			[21, 52],
			[21.01, 52.01]
		];
		const shape = encodePolyline6(points);
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json(
					{ error_code: 443, error: 'Exact route match algorithm failed to find path' },
					{ status: 400 }
				)
			)
			.mockResolvedValueOnce(
				Response.json({
					shape,
					edges: [
						{
							way_id: 88,
							length: 1.5,
							begin_shape_index: 0,
							end_shape_index: 1,
							names: ['DW296']
						}
					]
				})
			);

		const result = await fetchValhallaAttributes(
			{ type: 'LineString', coordinates: points },
			{
				baseUrl: 'https://valhalla.test',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(
			fetchFn.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).shape_match)
		).toEqual(['edge_walk', 'walk_or_snap']);
		expect(result).toMatchObject({ ok: true, roadSpans: [{ ref: 'DW296', wayId: 88 }] });
	});
});
