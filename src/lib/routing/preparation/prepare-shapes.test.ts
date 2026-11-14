import { describe, expect, it } from 'vitest';
import type { Feature, Position } from 'geojson';
import { prepareRouteShapes } from './prepare-shapes';

/** About 111 m per unit northward and 68 m per unit eastward near 52°N. */
function at(x: number, y: number): Position {
	return [21 + x * 0.001, 52 + y * 0.001];
}

function line(...coordinates: Position[]): Feature {
	return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
}

function visits(vias: Position[], position: Position): number {
	return vias.filter((via) => via[0] === position[0] && via[1] === position[1]).length;
}

/** Vias as drawn, in either walking direction. */
function walkedEitherWay(vias: Position[], expected: Position[]): boolean {
	const key = (points: Position[]) => JSON.stringify(points);
	return key(vias) === key(expected) || key(vias) === key([...expected].reverse());
}

describe('prepareRouteShapes', () => {
	it('builds vias from a polyline', () => {
		const features: Feature[] = [
			{
				type: 'Feature',
				properties: { tool: 'polyline' },
				geometry: {
					type: 'LineString',
					coordinates: [
						[21, 52],
						[21.01, 52.01],
						[21.02, 52.02]
					]
				}
			}
		];
		const result = prepareRouteShapes(features);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.shapes).toHaveLength(1);
		expect(result.shapes[0]!.vias.length).toBeGreaterThanOrEqual(2);
	});

	it('re-appends the start for polygon vias', () => {
		const features: Feature[] = [
			{
				type: 'Feature',
				properties: { tool: 'polygon' },
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[21, 52],
							[21.02, 52],
							[21.02, 52.02],
							[21, 52.02],
							[21, 52]
						]
					]
				}
			}
		];
		const result = prepareRouteShapes(features);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const vias = result.shapes[0]!.vias;
		const first = vias[0]!;
		const last = vias[vias.length - 1]!;
		expect(first[0]).toBe(last[0]);
		expect(first[1]).toBe(last[1]);
	});

	it('rejects empty sketch', () => {
		const result = prepareRouteShapes([]);
		expect(result.ok).toBe(false);
	});

	it('joins touching features into one walk and keeps disconnected ones apart', () => {
		const result = prepareRouteShapes(
			[line(at(0, 0), at(1, 0)), line(at(20, 0), at(21, 0)), line(at(1, 0), at(1, 1))],
			{ maxVias: 5 }
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.shapes).toHaveLength(2);
		expect(result.shapes.every((shape) => !shape.closed)).toBe(true);
		const [joined, apart] = [...result.shapes].sort((a, b) => b.vias.length - a.vias.length);
		expect(walkedEitherWay(joined!.vias, [at(0, 0), at(1, 0), at(1, 1)])).toBe(true);
		expect(walkedEitherWay(apart!.vias, [at(20, 0), at(21, 0)])).toBe(true);
	});

	it('walks every arm of crossing features through their junction', () => {
		const tips = [at(-1, 0), at(1, 0), at(0, -1), at(0, 1)];
		const result = prepareRouteShapes([line(tips[0]!, tips[1]!), line(tips[2]!, tips[3]!)]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.shapes).toHaveLength(1);
		const { vias, closed } = result.shapes[0]!;
		expect(closed).toBe(false);
		for (const tip of tips) expect(visits(vias, tip)).toBe(1);
		// Two arms are ridden once at the ends; the other two go out and back through the center.
		expect(visits(vias, at(0, 0))).toBe(3);
		expect(vias).toHaveLength(7);
	});

	it('retraces a short spur to its dead-end tip even within the simplify tolerance', () => {
		const result = prepareRouteShapes([line(at(0, 0), at(2, 0)), line(at(1, 0), at(1, 0.2))], {
			maxVias: 6
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.shapes).toHaveLength(1);
		const { vias } = result.shapes[0]!;
		expect(visits(vias, at(1, 0.2))).toBe(1);
		expect(visits(vias, at(1, 0))).toBe(2);
		expect(vias).toHaveLength(5);
	});

	it('starts a closed walk at its junction so the loop start costs no extra via', () => {
		const polygon = (...ring: Position[]): Feature => ({
			type: 'Feature',
			properties: {},
			geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] }
		});
		const junction = at(1, 1);
		const result = prepareRouteShapes([
			polygon(at(0, 0), at(2, 0), junction),
			polygon(junction, at(2, 2), at(0, 2))
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.shapes).toHaveLength(1);
		const { vias, closed } = result.shapes[0]!;
		expect(closed).toBe(true);
		expect(vias[0]).toEqual(junction);
		expect(visits(vias, junction)).toBe(3);
	});

	it('shares one via budget across shapes while preserving a closed loop', () => {
		const features: Feature[] = [
			{
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: [
						[21, 52],
						[21.01, 52.01],
						[21.02, 52.02]
					]
				}
			},
			{
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[21.03, 52.03],
							[21.04, 52.03],
							[21.04, 52.04],
							[21.03, 52.04],
							[21.03, 52.03]
						]
					]
				}
			}
		];

		const result = prepareRouteShapes(features, { maxVias: 5 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.shapes.flatMap((shape) => shape.vias)).toHaveLength(5);
		const closed = result.shapes.find((shape) => shape.closed)!.vias;
		expect(closed).toHaveLength(3);
		expect(closed[0]).toEqual(closed[closed.length - 1]);
	});

	it('allocates tied sampling budgets independently of feature order', () => {
		const features: Feature[] = [0, 1, 2].map((index) => ({
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'LineString',
				coordinates: [
					[index, 0],
					[index + 0.01, 0]
				]
			}
		}));

		const forward = prepareRouteShapes(features, { maxVias: 7 });
		const reversed = prepareRouteShapes([...features].reverse(), { maxVias: 7 });
		expect(reversed).toEqual(forward);
	});

	it('rejects sketches whose route-wide minimum exceeds the via cap', () => {
		const features: Feature[] = Array.from({ length: 21 }, (_, index) => ({
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[index, 0],
						[index + 0.1, 0],
						[index + 0.1, 0.1],
						[index, 0]
					]
				]
			}
		}));

		const result = prepareRouteShapes(features);
		expect(result).toEqual({
			ok: false,
			error: 'Too many shapes and junctions to route at once (max 60 waypoints).'
		});
	});
});
