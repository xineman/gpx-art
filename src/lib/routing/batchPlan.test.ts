import { describe, expect, test } from 'vitest';
import { buildRoutePlan } from './batchPlan';
import { ROUTE_DEBUG_PALETTE } from '$lib/constants/routing';
import type { Point, Shape } from '$lib/types/sketch';

const point = (lat: number, lng: number): Point => ({ lat, lng });
const shape = (id: string, type: Shape['type'], points: Point[]): Shape => ({ id, type, points });

describe('buildRoutePlan', () => {
	test('returns an empty plan for empty input', () => {
		expect(buildRoutePlan([], [])).toEqual([]);
	});

	test('skips shapes that collapsed below 2 points', () => {
		const shapes = [shape('a', 'line', [point(0, 0), point(1, 1)])];
		const processed = [[point(0, 0)]];

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
			color: ROUTE_DEBUG_PALETTE[0],
			startIndex: 0,
			endIndex: 4
		});
		expect(plan[0].points).toHaveLength(4);
	});

	test('emits one batch per shape including pencil', () => {
		const pencil = Array.from({ length: 8 }, (_, i) => point(i * 0.001, i * 0.001));
		const rectangle = [point(0, 0), point(0, 1), point(1, 1), point(1, 0)];

		const plan = buildRoutePlan(
			[shape('a', 'pencil', pencil), shape('b', 'rectangle', rectangle)],
			[pencil, rectangle]
		);

		expect(plan).toHaveLength(2);
		expect(plan.every((b) => b.callKind === 'route')).toBe(true);
		expect(plan[0].shapeType).toBe('pencil');
		expect(plan[0].points).toHaveLength(8);
		expect(plan[0].color).toBe(ROUTE_DEBUG_PALETTE[0]);
		expect(plan[1].color).toBe(ROUTE_DEBUG_PALETTE[1]);
		expect(plan[1].callKind).toBe('route');
	});

	test('colors each batch in emit order', () => {
		const a = [point(0, 0), point(0, 1)];
		const b = [point(1, 0), point(1, 1)];
		const c = [point(2, 0), point(2, 1)];

		const plan = buildRoutePlan(
			[shape('a', 'line', a), shape('b', 'line', b), shape('c', 'line', c)],
			[a, b, c]
		);

		expect(plan.map((p) => p.color)).toEqual([
			ROUTE_DEBUG_PALETTE[0],
			ROUTE_DEBUG_PALETTE[1],
			ROUTE_DEBUG_PALETTE[2]
		]);
	});

	test('does not mutate processed point arrays', () => {
		const points = [point(0, 0), point(1, 1)];
		const plan = buildRoutePlan([shape('a', 'line', points)], [points]);
		plan[0].points[0] = point(9, 9);
		expect(points[0]).toEqual(point(0, 0));
	});
});
