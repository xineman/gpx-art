import { describe, expect, it, vi } from 'vitest';
import {
	buildValhallaRouteUrl,
	buildValhallaTraceBody,
	buildValhallaTraceUrl,
	decodePolyline6,
	fetchValhallaTrace
} from './valhalla';

const vias = [{ location: [21, 52] }, { location: [21.01, 52.01] }];

describe('Valhalla trace request', () => {
	it('uses the trace_attributes endpoint', () => {
		expect(buildValhallaTraceUrl('https://valhalla.example/')).toBe(
			'https://valhalla.example/trace_attributes'
		);
	});

	it('uses the route endpoint for local gap repairs', () => {
		expect(buildValhallaRouteUrl('https://valhalla.example/')).toBe(
			'https://valhalla.example/route'
		);
	});

	it('builds a bicycle map-matching body with optional point constraints', () => {
		const body = buildValhallaTraceBody({
			vias: [
				{ location: [21, 52] },
				{ location: [21.01, 52.01], radiusM: 20, bearing: 45, bearingRange: 30 }
			],
			continueStraight: true
		});

		expect(body).toMatchObject({
			costing: 'bicycle',
			shape_match: 'map_snap',
			units: 'kilometers',
			shape: [
				{ lat: 52, lon: 21 },
				{ lat: 52.01, lon: 21.01, radius: 20, heading: 45, heading_tolerance: 30 }
			],
			trace_options: { search_radius: 100 }
		});
		expect(body.filters.attributes).toContain('matched.point');
		expect(body.filters.attributes).toContain('edge.length');
		expect(body.filters.attributes).toContain('edge.begin_shape_index');
		expect(body.filters.attributes).toContain('edge.end_shape_index');
	});
});

describe('decodePolyline6', () => {
	it('decodes a Valhalla coordinate as GeoJSON longitude, latitude', () => {
		expect(decodePolyline6('cj|rbBkxkag@')).toEqual([[21.010838, 52.230834]]);
	});

	it('rejects a truncated coordinate pair', () => {
		expect(decodePolyline6('c')).toBeNull();
	});
});

describe('fetchValhallaTrace', () => {
	it('POSTs and parses matched geometry, distance, and waypoints', async () => {
		const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			void url;
			void init;
			return Response.json({
				units: 'kilometers',
				shape: '????',
				edges: [{ length: 0.4 }, { length: 0.1 }],
				matched_points: [
					{ lon: 21.0001, lat: 52.0001, type: 'matched' },
					{ lon: 21.0099, lat: 52.0099, type: 'matched' }
				],
				alternate_paths: []
			});
		});

		const result = await fetchValhallaTrace(
			{ vias },
			{
				baseUrl: 'https://valhalla.example',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(fetchFn.mock.calls[0]?.[0]).toBe('https://valhalla.example/trace_attributes');
		expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
		expect(result).toEqual({
			ok: true,
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[0, 0]
				]
			},
			distanceM: 500,
			waypoints: [
				[21.0001, 52.0001],
				[21.0099, 52.0099]
			]
		});
	});

	it('falls back to input vias when matched points are omitted', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({ shape: '????', edges: [{ length: 1 }], alternate_paths: [] })
		);
		const result = await fetchValhallaTrace(
			{ vias },
			{
				baseUrl: 'https://valhalla.example',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.waypoints).toEqual(vias.map(({ location }) => location));
	});

	it('replaces geometry between disconnected trace edges with a bicycle route', async () => {
		let call = 0;
		const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
			void _url;
			void _init;
			call += 1;
			return call === 1
				? Response.json({
						shape: '????',
						edges: [
							{ length: 0.1, begin_shape_index: 0, end_shape_index: 0 },
							{ length: 0.1, begin_shape_index: 1, end_shape_index: 1 }
						],
						matched_points: [
							{ lon: 21, lat: 52, type: 'matched' },
							{ lon: 21.01, lat: 52.01, type: 'matched' }
						]
					})
				: Response.json({
						code: 'Ok',
						routes: [
							{
								distance: 250,
								geometry: {
									type: 'LineString',
									coordinates: [
										[0, 0],
										[0.001, 0.001],
										[0, 0]
									]
								}
							}
						]
					});
		});

		const result = await fetchValhallaTrace(
			{ vias },
			{
				baseUrl: 'https://valhalla.example',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
			'https://valhalla.example/trace_attributes',
			'https://valhalla.example/route'
		]);
		expect(result).toEqual({
			ok: true,
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[0.001, 0.001],
					[0, 0]
				]
			},
			distanceM: 450,
			waypoints: [
				[21, 52],
				[21.01, 52.01]
			]
		});
	});

	it('preserves server failures unrelated to matching', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({ error: 'Rate limit exceeded', status_code: 429 }, { status: 429 })
		);
		const result = await fetchValhallaTrace(
			{ vias },
			{
				baseUrl: 'https://valhalla.example',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(result).toEqual({
			ok: false,
			error: 'Rate limit exceeded',
			status: 429
		});
	});

	it('removes unmatched interior points and retries the trace once', async () => {
		const requestVias = [
			{ location: [21, 52] },
			{ location: [21.005, 52.005] },
			{ location: [21.01, 52.01] }
		];
		let call = 0;
		const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
			void _url;
			void _init;
			call += 1;
			return call === 1
				? Response.json({
						shape: '????',
						matched_points: [
							{ lon: 21, lat: 52, type: 'matched', begin_route_discontinuity: true },
							{ lon: 21.005, lat: 52.005, type: 'unmatched' },
							{ lon: 21.01, lat: 52.01, type: 'matched', end_route_discontinuity: true }
						]
					})
				: Response.json({
						shape: '????',
						edges: [{ length: 0.75 }],
						matched_points: [
							{ lon: 21.0001, lat: 52.0001, type: 'matched' },
							{ lon: 21.0099, lat: 52.0099, type: 'matched' }
						]
					});
		});

		const result = await fetchValhallaTrace(
			{ vias: requestVias },
			{
				baseUrl: 'https://valhalla.example',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(
			JSON.parse(String((fetchFn.mock.calls[1]?.[1] as RequestInit | undefined)?.body)).shape
		).toEqual([
			{ lat: 52, lon: 21 },
			{ lat: 52.01, lon: 21.01 }
		]);
		expect(result).toEqual({
			ok: true,
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[0, 0]
				]
			},
			distanceM: 750,
			waypoints: [
				[21.0001, 52.0001],
				[21.0099, 52.0099]
			]
		});
	});

	it('removes an unmatched endpoint without treating it specially', async () => {
		const requestVias = [
			{ location: [21, 52] },
			{ location: [21.01, 52.01] },
			{ location: [21.02, 52.02] }
		];
		let call = 0;
		const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
			void _url;
			void _init;
			call += 1;
			return call === 1
				? Response.json({
						shape: '????',
						matched_points: [
							{ lon: 21, lat: 52, type: 'unmatched' },
							{ lon: 21.01, lat: 52.01, type: 'matched' },
							{ lon: 21.02, lat: 52.02, type: 'matched' }
						]
					})
				: Response.json({
						shape: '????',
						matched_points: [
							{ lon: 21.01, lat: 52.01, type: 'matched' },
							{ lon: 21.02, lat: 52.02, type: 'matched' }
						]
					});
		});

		const result = await fetchValhallaTrace(
			{ vias: requestVias },
			{
				baseUrl: 'https://valhalla.example',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(
			JSON.parse(String((fetchFn.mock.calls[1]?.[1] as RequestInit | undefined)?.body)).shape
		).toEqual([
			{ lat: 52.01, lon: 21.01 },
			{ lat: 52.02, lon: 21.02 }
		]);
		expect(result.ok).toBe(true);
	});

	it('rejects a discontinuous match', async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({
				shape: '????',
				matched_points: [
					{ lon: 21, lat: 52, type: 'matched', end_route_discontinuity: true },
					{ lon: 21.01, lat: 52.01, type: 'matched' }
				]
			})
		);
		const result = await fetchValhallaTrace(
			{ vias },
			{
				baseUrl: 'https://valhalla.example',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(result).toEqual({
			ok: false,
			error: 'The sketch could not be matched continuously to bike roads.'
		});
	});

	it('handles network failure', async () => {
		const fetchFn = vi.fn(async () => {
			throw new Error('offline');
		});
		const result = await fetchValhallaTrace(
			{ vias },
			{
				baseUrl: 'https://valhalla.example',
				userAgent: 'test',
				fetchFn: fetchFn as unknown as typeof fetch
			}
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/reach the routing/i);
	});
});
