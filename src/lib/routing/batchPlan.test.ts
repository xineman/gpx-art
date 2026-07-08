import { describe, expect, test } from 'vitest';
import { attachOutcomes, buildRoutePlan } from './batchPlan';
import { MATCH_DEBUG_PALETTE } from '$lib/constants/routing';
import type { Point, Shape } from '$lib/types/sketch';

const point = (lat: number, lng: number): Point => ({ lat, lng });
const shape = (id: string, type: Shape['type'], points: Point[]): Shape => ({ id, type, points });

describe('buildRoutePlan', () => {
	test('returns an empty plan for empty input', () => {
		expect(buildRoutePlan([], [])).toEqual([]);
	});

	test('skips shapes that collapsed below 2 points', () => {
		const shapes = [shape('a', 'line', [point(0, 0), point(1, 1)])];
		const processed = [[point(0, 0)]]; // simplified down to 1 point

		expect(buildRoutePlan(shapes, processed)).toEqual([]);
	});

	test('emits a single route batch for a structured shape', () => {
		const shapes = [shape('a', 'rectangle', [point(0, 0), point(0, 1), point(1, 1), point(1, 0)])];
		const processed = [[point(0, 0), point(0, 1), point(1, 1), point(1, 0)]];

		const plan = buildRoutePlan(shapes, processed);

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

	test('chunks a pencil shape using MATCH_MAX_POINTS=10 with overlap', () => {
		// 25-point pencil stroke → 3 chunks (10, 10, 9) with overlap 2.
		// Stride = 10 - 2 = 8 → starts at 0, 8, 16. Third chunk runs from
		// 16 to 25 (9 points). chunkPointsForMatch's degenerate-tail rule
		// is for when the natural last chunk would be only 2 points; 9
		// is comfortably above that threshold.
		const points = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const shapes = [shape('a', 'pencil', points)];

		const plan = buildRoutePlan(shapes, [points]);

		expect(plan).toHaveLength(3);
		expect(plan.map((b) => b.points.length)).toEqual([10, 10, 9]);
		expect(plan.every((b) => b.callKind === 'match')).toBe(true);
		// Adjacent chunks of the same shape get DIFFERENT colors — the
		// whole point of the overlay is to distinguish chunks at a glance.
		expect(plan[0].color).toBe(MATCH_DEBUG_PALETTE[0]);
		expect(plan[1].color).toBe(MATCH_DEBUG_PALETTE[1]);
		expect(plan[2].color).toBe(MATCH_DEBUG_PALETTE[2]);
		expect(new Set(plan.map((b) => b.color)).size).toBe(3);
		// Chunks share 2 overlap points with their neighbours (the
		// overlap comes from chunkPointsForMatch's stride = maxPoints - overlap).
		expect(plan[0].points.at(-1)).toBe(plan[1].points[1]);
		expect(plan[1].points.at(-1)).toBe(plan[2].points[1]);
	});

	test('colors each batch in emit order across multiple shapes', () => {
		const pencil = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const rectangle = [point(0, 0), point(0, 1), point(1, 1), point(1, 0)];

		const plan = buildRoutePlan(
			[shape('a', 'pencil', pencil), shape('b', 'rectangle', rectangle)],
			[pencil, rectangle]
		);

		// Shape a (pencil) emits 3 chunks at slots 0, 1, 2.
		expect(plan[0].color).toBe(MATCH_DEBUG_PALETTE[0]);
		expect(plan[1].color).toBe(MATCH_DEBUG_PALETTE[1]);
		expect(plan[2].color).toBe(MATCH_DEBUG_PALETTE[2]);
		// Shape b (rectangle) emits 1 batch at slot 3.
		expect(plan[3].color).toBe(MATCH_DEBUG_PALETTE[3]);
		expect(plan[3].callKind).toBe('route');
	});

	test('handles a single small pencil shape as a single chunk', () => {
		const points = Array.from({ length: 8 }, (_, i) => point(i * 0.001, i * 0.001));

		const plan = buildRoutePlan([shape('a', 'pencil', points)], [points]);

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
		// 11 points, max 10, overlap 2 → stride 8. Chunks at start=0 (10 pts)
		// and start=8 (3 pts). No degenerate-tail since last chunk has ≥2.
		const points = Array.from({ length: 11 }, (_, i) => point(i * 0.001, i * 0.001));

		const plan = buildRoutePlan([shape('a', 'pencil', points)], [points]);

		expect(plan).toHaveLength(2);
		expect(plan.map((b) => b.points.length)).toEqual([10, 3]);
	});
});

describe('attachOutcomes', () => {
	test('attaches each outcome to the matching (shapeIndex, chunkIndex) batch', () => {
		// Single pencil shape, 25 points → 3 chunks. Pick distinct outcomes
		// per chunk to confirm the zip is by (shapeIndex, chunkIndex), not
		// just by batch order.
		const points = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const plan = buildRoutePlan([shape('a', 'pencil', points)], [points]);
		const outcomes = [
			{ kind: 'matched' as const, confidence: 0.91 },
			{ kind: 'fallback' as const, reason: 'no_match' as const, code: 'NoMatch' as const },
			{ kind: 'matched' as const, confidence: 0.74 }
		];

		const withOutcomes = attachOutcomes(plan, [outcomes]);

		expect(withOutcomes.map((b) => b.outcome)).toEqual(outcomes);
	});

	test('leaves structured-shape batches with no outcome', () => {
		// Rectangle has no /match chunks and no fallback path — its batch
		// must keep `outcome: undefined` so the legend renders the blue
		// `route` pill instead of a matched/fallback pill.
		const rectangle = [point(0, 0), point(0, 1), point(1, 1), point(1, 0)];
		const plan = buildRoutePlan([shape('a', 'rectangle', rectangle)], [rectangle]);

		const withOutcomes = attachOutcomes(plan, [undefined]);

		expect(withOutcomes[0].outcome).toBeUndefined();
	});

	test('mixes matched and fallback outcomes across multiple shapes', () => {
		// Pencil shape (3 chunks, shapeIndex 0) + rectangle (1 batch,
		// shapeIndex 1). The pencil chunks get per-chunk outcomes, the
		// rectangle batch stays undefined.
		const pencil = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const rectangle = [point(0, 0), point(0, 1), point(1, 1), point(1, 0)];
		const plan = buildRoutePlan(
			[shape('a', 'pencil', pencil), shape('b', 'rectangle', rectangle)],
			[pencil, rectangle]
		);

		const withOutcomes = attachOutcomes(plan, [
			[
				{ kind: 'matched' as const, confidence: 0.91 },
				{ kind: 'matched' as const, confidence: 0.84 },
				{
					kind: 'fallback' as const,
					reason: 'low_confidence' as const,
					code: 'LowConfidence' as const
				}
			],
			undefined // rectangle has no /match chunks
		]);

		expect(withOutcomes[0].outcome).toEqual({ kind: 'matched', confidence: 0.91 });
		expect(withOutcomes[1].outcome).toEqual({ kind: 'matched', confidence: 0.84 });
		expect(withOutcomes[2].outcome).toEqual({
			kind: 'fallback',
			reason: 'low_confidence',
			code: 'LowConfidence'
		});
		expect(withOutcomes[3].outcome).toBeUndefined();
	});

	test('does not mutate the input plan', () => {
		const points = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const plan = buildRoutePlan([shape('a', 'pencil', points)], [points]);
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
		// Defensive: if attachOutcomes ever sees an outcomes array shorter
		// than the plan (e.g. a partial build during a streaming render),
		// the missing batches should stay `outcome: undefined` rather than
		// throw — the panel's defensive branch in statusPill() handles them.
		const points = Array.from({ length: 25 }, (_, i) => point(i * 0.001, i * 0.001));
		const plan = buildRoutePlan([shape('a', 'pencil', points)], [points]);

		const withOutcomes = attachOutcomes(plan, [
			[{ kind: 'matched' as const, confidence: 0.91 }] // only chunk 0
		]);

		expect(withOutcomes[0].outcome).toEqual({ kind: 'matched', confidence: 0.91 });
		expect(withOutcomes[1].outcome).toBeUndefined();
		expect(withOutcomes[2].outcome).toBeUndefined();
	});
});
