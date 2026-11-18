import { describe, expect, it } from 'vitest';
import { findBacktracking, introducesBacktracking } from './backtracking';
import warsaw from './fixtures/warsaw-backtrack.json';
import turnaround from './fixtures/warsaw-turnaround.json';

const a = [21, 52];
const junction = [21.001, 52];
const tip = [21.001, 52.001];
const b = [21.002, 52];

const spur = [a, junction, tip, junction, b];

describe('unintended backtracking', () => {
	it('detects the exported Warsaw excursion', () => {
		const branches = findBacktracking(warsaw.route);
		const reported = branches.find(({ tip }) => tip === 164);
		expect(reported).toMatchObject({ start: 115, tip: 164, end: 213 });
		expect(reported!.distanceM).toBeCloseTo(828.49, 1);
	});

	it('leaves tiny reversals, route endpoints, loops and parallel roads alone', () => {
		expect(findBacktracking([a, junction, [21.001, 52.00001], junction, b])).toEqual([]);
		expect(findBacktracking([junction, tip, junction, b])).toEqual([]);
		expect(findBacktracking([a, junction, tip, [21.0012, 52.001], [21.0012, 52], b])).toEqual([]);
		expect(findBacktracking([a, junction, tip, [21.002, 52.001], b])).toEqual([]);
	});

	it('detects consecutive spurs at one junction', () => {
		const secondTip = [21.001, 51.999];
		const adjacent = [a, junction, tip, junction, secondTip, junction, b];
		expect(findBacktracking(adjacent)).toMatchObject([
			{ start: 1, tip: 2, end: 3 },
			{ start: 3, tip: 4, end: 5 }
		]);
		expect(introducesBacktracking(spur, adjacent)).toBe(true);
	});

	it('allows shortening an existing spur without mistaking its moved tip for a new one', () => {
		const shorter = [a, junction, [21.001, 52.0003], junction, b];
		expect(introducesBacktracking(spur, shorter)).toBe(false);
		expect(introducesBacktracking(shorter, spur)).toBe(true);
	});

	it('detects the live turnaround loop missed by symmetric-tip detection', () => {
		const branches = findBacktracking(turnaround.route);
		expect(branches).toHaveLength(1);
		expect(branches[0]).toMatchObject({ start: 1, end: 105 });
		expect(branches[0]!.distanceM).toBeGreaterThan(800);
	});
});
