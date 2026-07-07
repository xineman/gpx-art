import { describe, expect, test } from 'vitest';
import { sampleTrace } from './sample';

describe('sampleTrace', () => {
	test('keeps endpoints for a short segment', () => {
		const start = { lat: 52, lng: 21 };
		const end = { lat: 52.0001, lng: 21 };

		expect(sampleTrace([start, end], 60)).toEqual([start, end]);
	});

	test('inserts intermediate points along a long segment', () => {
		const start = { lat: 52, lng: 21 };
		const end = { lat: 52.002, lng: 21 };

		const sampled = sampleTrace([start, end], 60);

		expect(sampled[0]).toEqual(start);
		expect(sampled.at(-1)).toEqual(end);
		expect(sampled.length).toBeGreaterThan(2);
		for (let i = 1; i < sampled.length; i++) {
			expect(sampled[i].lat).toBeGreaterThan(sampled[i - 1].lat);
			expect(sampled[i].lng).toBe(21);
		}
	});

	test('preserves a closed rectangle as closed after sampling', () => {
		const topLeft = { lat: 52.001, lng: 21 };
		const topRight = { lat: 52.001, lng: 21.002 };
		const bottomRight = { lat: 52, lng: 21.002 };
		const bottomLeft = { lat: 52, lng: 21 };

		const sampled = sampleTrace([topLeft, topRight, bottomRight, bottomLeft, topLeft], 60);

		expect(sampled[0]).toEqual(topLeft);
		expect(sampled.at(-1)).toEqual(topLeft);
		expect(sampled.length).toBeGreaterThan(5);
	});

	test('rejects non-positive spacing', () => {
		expect(() =>
			sampleTrace(
				[
					{ lat: 52, lng: 21 },
					{ lat: 52.001, lng: 21 }
				],
				0
			)
		).toThrow('greater than 0');
	});
});
