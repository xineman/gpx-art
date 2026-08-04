import { describe, expect, it } from 'vitest';
import { isDoubleTap, isWithinPx, resolveVertexClick } from './tap';

describe('isWithinPx', () => {
	it('accepts points inside the radius', () => {
		expect(isWithinPx({ x: 0, y: 0 }, { x: 10, y: 10 }, 28)).toBe(true);
	});

	it('rejects points outside the radius', () => {
		expect(isWithinPx({ x: 0, y: 0 }, { x: 30, y: 0 }, 28)).toBe(false);
	});
});

describe('isDoubleTap', () => {
	const origin = { x: 100, y: 200 };

	it('is false without a previous tap', () => {
		expect(isDoubleTap(null, 1000, origin)).toBe(false);
	});

	it('accepts a quick re-tap near the previous point', () => {
		expect(isDoubleTap({ t: 1000, screen: origin }, 1200, { x: 105, y: 198 }, 350, 28)).toBe(true);
	});

	it('rejects a slow re-tap', () => {
		expect(isDoubleTap({ t: 1000, screen: origin }, 1500, { x: 105, y: 198 }, 350, 28)).toBe(false);
	});

	it('rejects a quick tap far from the previous point', () => {
		expect(isDoubleTap({ t: 1000, screen: origin }, 1100, { x: 200, y: 200 }, 350, 28)).toBe(false);
	});
});

describe('resolveVertexClick', () => {
	const last = { x: 100, y: 100 };
	const nearLast = { x: 105, y: 102 };
	const elsewhere = { x: 300, y: 300 };

	it('finishes on re-tap of last vertex when canFinish (no time limit)', () => {
		expect(
			resolveVertexClick({
				canFinish: true,
				lastVertexScreen: last,
				screen: nearLast,
				lastTap: { t: 1000, screen: last },
				// Well past DOUBLE_TAP_MS — still finishes via last-vertex path.
				now: 5000
			})
		).toBe('finish-last');
	});

	it('finishes on quick double-tap of last vertex at min count (finish-last wins)', () => {
		// This is the advertised touch UX: double-tap last point with 2 polyline verts.
		expect(
			resolveVertexClick({
				canFinish: true,
				lastVertexScreen: last,
				screen: nearLast,
				lastTap: { t: 1000, screen: last },
				now: 1200
			})
		).toBe('finish-last');
	});

	it('undoes then finishes when double-tapping a new point (not last vertex)', () => {
		expect(
			resolveVertexClick({
				canFinish: true,
				lastVertexScreen: last,
				screen: elsewhere,
				lastTap: { t: 1000, screen: elsewhere },
				now: 1200
			})
		).toBe('finish-double-tap-undo');
	});

	it('places when cannot finish and not a double-tap', () => {
		expect(
			resolveVertexClick({
				canFinish: false,
				lastVertexScreen: last,
				screen: nearLast,
				lastTap: { t: 1000, screen: last },
				now: 5000
			})
		).toBe('place');
	});

	it('places on a slow tap elsewhere', () => {
		expect(
			resolveVertexClick({
				canFinish: true,
				lastVertexScreen: last,
				screen: elsewhere,
				lastTap: { t: 1000, screen: last },
				now: 5000
			})
		).toBe('place');
	});
});

describe('resolveVertexClick close-at-start', () => {
	const first = { x: 400, y: 400 };
	const last = { x: 100, y: 100 };
	const nearFirst = { x: 402, y: 401 };
	const elsewhere = { x: 300, y: 300 };

	it('closes when tapping near the first vertex (no time limit)', () => {
		expect(
			resolveVertexClick({
				canFinish: true,
				lastVertexScreen: last,
				firstVertexScreen: first,
				screen: nearFirst,
				lastTap: { t: 1000, screen: last },
				now: 5000
			})
		).toBe('close-first');
	});

	it('does not close at start when the ring cannot finish', () => {
		expect(
			resolveVertexClick({
				canFinish: false,
				lastVertexScreen: last,
				firstVertexScreen: first,
				screen: nearFirst,
				lastTap: null,
				now: 1000
			})
		).toBe('place');
	});

	it('prefers close-at-start when the last vertex sits near the first', () => {
		expect(
			resolveVertexClick({
				canFinish: true,
				lastVertexScreen: nearFirst,
				firstVertexScreen: first,
				screen: nearFirst,
				lastTap: null,
				now: 1000
			})
		).toBe('close-first');
	});

	it('prefers close-at-start over a quick double-tap at the first vertex', () => {
		expect(
			resolveVertexClick({
				canFinish: true,
				lastVertexScreen: last,
				firstVertexScreen: first,
				screen: nearFirst,
				lastTap: { t: 1000, screen: nearFirst },
				now: 1200
			})
		).toBe('close-first');
	});

	it('places when no first vertex is ring-eligible', () => {
		expect(
			resolveVertexClick({
				canFinish: true,
				lastVertexScreen: last,
				firstVertexScreen: null,
				screen: nearFirst,
				lastTap: null,
				now: 1000
			})
		).toBe('place');
	});

	it('places when tapping far from the first vertex', () => {
		expect(
			resolveVertexClick({
				canFinish: true,
				lastVertexScreen: last,
				firstVertexScreen: first,
				screen: elsewhere,
				lastTap: null,
				now: 1000
			})
		).toBe('place');
	});
});
