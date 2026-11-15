import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseApiFailure, postJson, requestMatrix, requestRouteAttributes } from './client';

describe('routing endpoint clients', () => {
	it('returns a success payload that carries the required arrays', async () => {
		const payload = { ok: true, distances: [[0]] };
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json(payload))
		);

		expect(await requestMatrix([[21, 52]])).toEqual(payload);
	});

	it('rejects a success payload missing a required array', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ ok: true, roadSpans: [] }))
		);

		const result = await requestRouteAttributes({
			type: 'LineString',
			coordinates: [
				[21, 52],
				[21.01, 52.01]
			]
		});

		expect(result).toEqual({ ok: false, error: 'Road details response was unexpected.' });
	});

	it('passes server failures through with their provider status', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ ok: false, error: 'Busy.', status: 429 }, { status: 429 }))
		);

		expect(await requestMatrix([[21, 52]])).toEqual({ ok: false, error: 'Busy.', status: 429 });
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('routing HTTP client', () => {
	it('returns a structured superseded failure when its request is aborted', async () => {
		const controller = new AbortController();
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			void input;
			void init;
			throw new DOMException('Aborted', 'AbortError');
		});
		vi.stubGlobal('fetch', fetchMock);
		controller.abort();

		const result = await postJson('/api/route', {}, 'Network error.', {
			signal: controller.signal
		});

		expect(result).toEqual({
			ok: false,
			code: 'superseded',
			error: 'Superseded.'
		});
		expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
	});

	it('preserves a recognized failure code when parsing API failures', () => {
		expect(
			parseApiFailure({
				ok: false,
				code: 'superseded',
				error: 'Superseded.'
			})
		).toEqual({
			ok: false,
			code: 'superseded',
			error: 'Superseded.'
		});
	});
});
