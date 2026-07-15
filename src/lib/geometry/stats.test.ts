import { describe, expect, it } from 'vitest';
import type { Feature, LineString, Polygon } from 'geojson';
import {
	featuresLength,
	featuresPointCount,
	geometryLength,
	geometryPointCount,
	pointLabelFromCount
} from './stats';
import { pathLength } from './distance';

const line: LineString = {
	type: 'LineString',
	coordinates: [
		[21.0, 52.2],
		[21.0, 52.201],
		[21.01, 52.201]
	]
};

const closedSquare: Polygon = {
	type: 'Polygon',
	coordinates: [
		[
			[0, 0],
			[0.01, 0],
			[0.01, 0.01],
			[0, 0.01],
			[0, 0]
		]
	]
};

describe('geometryPointCount', () => {
	it('counts line vertices', () => {
		expect(geometryPointCount(line)).toBe(3);
	});

	it('drops the repeated close vertex on polygons', () => {
		expect(geometryPointCount(closedSquare)).toBe(4);
	});
});

describe('geometryLength', () => {
	it('matches path length for lines', () => {
		expect(geometryLength(line)).toBeCloseTo(pathLength(line.coordinates), 5);
	});

	it('includes the closing edge for polygons', () => {
		const ring = closedSquare.coordinates[0]!;
		expect(geometryLength(closedSquare)).toBeCloseTo(pathLength(ring), 5);
	});
});

describe('features aggregates', () => {
	it('sums independent features without a phantom jump', () => {
		const a: Feature = { type: 'Feature', properties: {}, geometry: line };
		const b: Feature = {
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'LineString',
				coordinates: [
					[22.0, 53.0],
					[22.0, 53.001]
				]
			}
		};
		const expected = geometryLength(a.geometry) + geometryLength(b.geometry);
		expect(featuresLength([a, b])).toBeCloseTo(expected, 5);
		expect(featuresPointCount([a, b])).toBe(5);
	});
});

describe('pointLabelFromCount', () => {
	it('matches the status-bar copy', () => {
		expect(pointLabelFromCount(0)).toBe('0 sketch pts');
		expect(pointLabelFromCount(12)).toBe('12 sketch pts');
	});
});
