import { describe, expect, it, vi } from 'vitest';
import { postValhalla, valhallaUrl } from './http.server';

function configFor(response: () => Response | Promise<Response>) {
	const fetchFn = vi.fn(async () => response());
	return {
		fetchFn,
		config: {
			baseUrl: 'https://valhalla.example/',
			userAgent: 'test-agent',
			fetchFn: fetchFn as unknown as typeof fetch
		}
	};
}

describe('Valhalla HTTP client', () => {
	it('joins endpoints onto a base URL with or without a trailing slash', () => {
		expect(valhallaUrl('https://valhalla.example/', 'trace_attributes')).toBe(
			'https://valhalla.example/trace_attributes'
		);
		expect(valhallaUrl('https://valhalla.example', 'route')).toBe('https://valhalla.example/route');
		expect(valhallaUrl('https://valhalla.example//', 'sources_to_targets')).toBe(
			'https://valhalla.example/sources_to_targets'
		);
	});

	it('POSTs JSON with the configured user agent and returns the parsed body', async () => {
		const { fetchFn, config } = configFor(() => Response.json({ shape: 'abc' }));

		const reply = await postValhalla<{ shape: string }>(config, 'route', { costing: 'bicycle' });

		expect(reply).toEqual({ ok: true, body: { shape: 'abc' } });
		expect(fetchFn).toHaveBeenCalledWith('https://valhalla.example/route', {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': 'test-agent'
			},
			body: JSON.stringify({ costing: 'bicycle' })
		});
	});

	it('classifies network failures as unreachable gateway failures', async () => {
		const { config } = configFor(() => {
			throw new Error('offline');
		});

		expect(await postValhalla(config, 'route', {})).toEqual({
			ok: false,
			reason: 'unreachable',
			status: 502
		});
	});

	it('keeps the HTTP status of unreadable failures and maps unreadable successes to 502', async () => {
		const failed = configFor(() => new Response('<html>busy</html>', { status: 429 }));
		const succeeded = configFor(() => new Response('not json'));

		expect(await postValhalla(failed.config, 'route', {})).toEqual({
			ok: false,
			reason: 'unreadable',
			status: 429,
			httpStatus: 429,
			httpOk: false
		});
		expect(await postValhalla(succeeded.config, 'route', {})).toEqual({
			ok: false,
			reason: 'unreadable',
			status: 502,
			httpStatus: 200,
			httpOk: true
		});
	});

	it('reports provider errors with their message, error code, and status', async () => {
		const rejected = configFor(() =>
			Response.json({ error: ' No path ', error_code: 442, status_code: 400 }, { status: 400 })
		);
		const errorInSuccess = configFor(() => Response.json({ error: 'Odd', status_code: 503 }));

		expect(await postValhalla(rejected.config, 'route', {})).toEqual({
			ok: false,
			reason: 'rejected',
			status: 400,
			httpStatus: 400,
			message: 'No path',
			errorCode: 442
		});
		expect(await postValhalla(errorInSuccess.config, 'route', {})).toMatchObject({
			ok: false,
			reason: 'rejected',
			status: 503,
			message: 'Odd'
		});
	});
});
