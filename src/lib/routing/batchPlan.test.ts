import { describe, expect, test } from 'vitest';
import { attachOutcomes, buildRoutePlan, usesMatchApi } from './batchPlan';
import { MATCH_DEBUG_PALETTE } from '$lib/constants/routing';
import type { Point, Shape } from '$lib/types/sketch';

const point = (lat: number, lng: number): Point => ({ lat, lng });
const shape = (id: string, type: Shape['type'], points: Point[]): Shape => ({ id, type, points });

describe('usesMatchApi', () => {
	test('only pencil uses /match', () => {
		expect(usesMatchApi('pencil')).toBe(true);
		expect(usesMatchApi('rectangle')).toBe(false);
		expect(usesMatchApi('line')).toBe(false);
		expect(usesMatchApi('polygon')).toBe(false);
	});
});

describe('buildRoutePlan', () => {
	test('returns an empty plan for empty input', () => {
		expect(buildRoutePlan([], [], [])).toEqual([]);
	});

	test('skips shapes that collapsed below 2 points', () => {
		const shapes = [shape('a', 'line', [point(0, 0), point(1, 1)])];
		const processed = [[point(0, 0)]];

		expect(buildRoutePlan(shapes, processed, ['route'])).toEqual([]);
	});

	test('emits a single route batch for a structured shape', () => {
		const shapes = [shape('a', 'rectangle', [point(0, 0), point(0, 1), point(1, 1), point(1, 0)])];
		const processed = [[point(0, 0), point(0, 1), point(1, 1), point(1, 0)]];

		const plan = buildRoutePlan(shapes, processed, ['route']);

		expect(plan).toHaveLength(1);
		expect(plan[0]).toMatchObject({
			shapeIndex: 0,
			shapeType: 'rectangle',
			callKind: 'route',
			chunkIndex: 0,
			chunkCount: 1,
			color: MATCH_DEBUG_PALETTE[0],
			startIndex: 0,
			endIndex: 4
		});
		expect(plan[0].points).toHaveLength(4);
	});

	test('chunks a densified pencil shape through /match when callKind is match', () => {
		const points = Array.from({ length: 12 }, (_, i) => point(i * 0.001, i * 0.001));
		const shapes = [shape('a', 'pencil', points.slice(0, 3))];

		const plan = buildRoutePlan(shapes, [points], ['match']);

		expect(plan.length).toBeGreaterThanOrEqual(1);
		expect(plan.every((b) => b.callKind === 'match')).toBe(true);
		expect(plan[0].shapeType).toBe('pencil');
	});

	test('respects callKinds over processed point density', () => {
		const points = Array.from({ length: 12 }, (_, i) => point(i * 0.001, i * 0.001));
		const plan = buildRoutePlan([shape('a', 'line', points.slice(0, 2))], [points], ['route']);
		expect(plan).toHaveLength(1);
		expect(plan[0].callKind).toBe('route');
	});

	test('chunks a pencil shape using MATCH_MAX_POINTS=10 with overlap', () => {
		const points = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const shapes = [shape('a', 'pencil', points)];

		const plan = buildRoutePlan(shapes, [points], ['match']);

		expect(plan).toHaveLength(3);
		expect(plan.map((b) => b.points.length)).toEqual([10, 10, 9]);
		expect(plan.every((b) => b.callKind === 'match')).toBe(true);
		expect(plan[0].color).toBe(MATCH_DEBUG_PALETTE[0]);
		expect(plan[1].color).toBe(MATCH_DEBUG_PALETTE[1]);
		expect(plan[2].color).toBe(MATCH_DEBUG_PALETTE[2]);
		expect(new Set(plan.map((b) => b.color)).size).toBe(3);
		expect(plan[0].points.at(-1)).toBe(plan[1].points[1]);
		expect(plan[1].points.at(-1)).toBe(plan[2].points[1]);
	});

	test('colors each batch in emit order across multiple shapes', () => {
		const pencil = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const rectangle = [point(0, 0), point(0, 1), point(1, 1), point(1, 0)];

		const plan = buildRoutePlan(
			[shape('a', 'pencil', pencil), shape('b', 'rectangle', rectangle)],
			[pencil, rectangle],
			['match', 'route']
		);

		expect(plan[0].color).toBe(MATCH_DEBUG_PALETTE[0]);
		expect(plan[1].color).toBe(MATCH_DEBUG_PALETTE[1]);
		expect(plan[2].color).toBe(MATCH_DEBUG_PALETTE[2]);
		expect(plan[3].color).toBe(MATCH_DEBUG_PALETTE[3]);
		expect(plan[3].callKind).toBe('route');
	});

	test('handles a single small pencil shape as a single chunk', () => {
		const points = Array.from({ length: 8 }, (_, i) => point(i * 0.001, i * 0.001));

		const plan = buildRoutePlan([shape('a', 'pencil', points)], [points], ['match']);

		expect(plan).toHaveLength(1);
		expect(plan[0]).toMatchObject({
			callKind: 'match',
			chunkIndex: 0,
			chunkCount: 1,
			startIndex: 0,
			endIndex: 8
		});
	});

	test('handles the 11-point edge case (one above MATCH_MAX_POINTS)', () => {
		const points = Array.from({ length: 11 }, (_, i) => point(i * 0.001, i * 0.001));

		const plan = buildRoutePlan([shape('a', 'pencil', points)], [points], ['match']);

		expect(plan).toHaveLength(2);
		expect(plan.map((b) => b.points.length)).toEqual([10, 3]);
	});
});

describe('attachOutcomes', () => {
	test('attaches each outcome to the matching (shapeIndex, chunkIndex) batch', () => {
		const points = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const plan = buildRoutePlan([shape('a', 'pencil', points)], [points], ['match']);
		const outcomes = [
			{ kind: 'matched' as const, confidence: 0.91 },
			{ kind: 'fallback' as const, code: 'NoMatch' as const },
			{ kind: 'matched' as const, confidence: 0.74 }
		];

		const withOutcomes = attachOutcomes(plan, [outcomes]);

		expect(withOutcomes.map((b) => b.outcome)).toEqual(outcomes);
	});

	test('leaves structured-shape batches with no outcome', () => {
		const rectangle = [point(0, 0), point(0, 1), point(1, 1), point(1, 0)];
		const plan = buildRoutePlan([shape('a', 'rectangle', rectangle)], [rectangle], ['route']);

		const withOutcomes = attachOutcomes(plan, [undefined]);

		expect(withOutcomes[0].outcome).toBeUndefined();
	});

	test('mixes matched and fallback outcomes across multiple shapes', () => {
		const pencil = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const rectangle = [point(0, 0), point(0, 1), point(1, 1), point(1, 0)];
		const plan = buildRoutePlan(
			[shape('a', 'pencil', pencil), shape('b', 'rectangle', rectangle)],
			[pencil, rectangle],
			['match', 'route']
		);

		const withOutcomes = attachOutcomes(plan, [
			[
				{ kind: 'matched' as const, confidence: 0.91 },
				{ kind: 'matched' as const, confidence: 0.84 },
				{ kind: 'fallback' as const, code: 'NoMatch' as const }
			],
			undefined
		]);

		expect(withOutcomes[0].outcome).toEqual({ kind: 'matched', confidence: 0.91 });
		expect(withOutcomes[1].outcome).toEqual({ kind: 'matched', confidence: 0.84 });
		expect(withOutcomes[2].outcome).toEqual({ kind: 'fallback', code: 'NoMatch' });
		expect(withOutcomes[3].outcome).toBeUndefined();
	});

	test('does not mutate the input plan', () => {
		const points = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const plan = buildRoutePlan([shape('a', 'pencil', points)], [points], ['match']);
		const before = JSON.stringify(plan);

		attachOutcomes(plan, [
			[
				{ kind: 'matched' as const, confidence: 0.91 },
				{ kind: 'matched' as const, confidence: 0.84 },
				{ kind: 'matched' as const, confidence: 0.74 }
			]
		]);

		expect(JSON.stringify(plan)).toBe(before);
	});

	test('leaves later batches without outcomes when the array is short', () => {
		const points = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const plan = buildRoutePlan([shape('a', 'pencil', points)], [points], ['match']);

		const withOutcomes = attachOutcomes(plan, [
			[{ kind: 'matched' as const, confidence: 0.91 }]
		]);

		expect(withOutcomes[0].outcome).toEqual({ kind: 'matched', confidence: 0.91 });
		expect(withOutcomes[1].outcome).toBeUndefined();
		expect(withOutcomes[2].outcome).toBeUndefined();
	});
});
