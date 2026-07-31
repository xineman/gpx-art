import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseApiFailure, postJson } from './http-client';

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
