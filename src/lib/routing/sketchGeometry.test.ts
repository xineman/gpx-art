import { describe, expect, test } from 'vitest';
import type { Point } from '$lib/types/sketch';
import { measureSketchGeometry } from './sketchGeometry';

const point = (lat: number, lng: number): Point => ({ lat, lng });
const deg = (meters: number) => meters / 111_000;

describe('measureSketchGeometry', () => {
	test('reports zero edges for a single point', () => {
		const profile = measureSketchGeometry([point(52, 21)]);
		expect(profile.edgeCount).toBe(0);
		expect(profile.vertexCount).toBe(1);
		expect(profile.maxEdgeM).toBe(0);
	});

	test('open chain edge stats', () => {
		const short = deg(50);
		const long = deg(200);
		const chain = [point(52, 21), point(52 + short, 21), point(52 + short + long, 21)];
		const profile = measureSketchGeometry(chain);
		expect(profile.vertexCount).toBe(3);
		expect(profile.edgeCount).toBe(2);
		expect(profile.isClosedChain).toBe(false);
		expect(profile.maxEdgeM).toBeGreaterThan(180);
		expect(profile.medianEdgeM).toBeGreaterThan(40);
	});

	test('closed ring does not double-count the repeated start', () => {
		const d = deg(100);
		const chain = [
			point(52, 21),
			point(52, 21 + d),
			point(52 + d, 21 + d),
			point(52 + d, 21),
			point(52, 21)
		];
		const profile = measureSketchGeometry(chain);
		expect(profile.isClosedChain).toBe(true);
		expect(profile.vertexCount).toBe(4);
		expect(profile.edgeCount).toBe(4);
	});
});
