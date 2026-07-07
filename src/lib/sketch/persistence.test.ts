import { describe, expect, test } from 'vitest';
import type { Snapshot } from '$lib/types/sketch';
import {
	SNAPSHOT_FORMAT,
	SNAPSHOT_VERSION,
	buildSnapshotEnvelope,
	parseSnapshotEnvelope
} from './persistence';

const validSnapshot: Snapshot = {
	shapes: [{ id: 'shape-1', type: 'pencil', points: [{ lat: 1, lng: 2 }] }],
	draft: null,
	phase: 'editing',
	routedPath: null
};

const validEnvelope = buildSnapshotEnvelope(validSnapshot);

describe('buildSnapshotEnvelope', () => {
	test('wraps a snapshot with format and version', () => {
		expect(validEnvelope).toEqual({
			format: SNAPSHOT_FORMAT,
			version: SNAPSHOT_VERSION,
			snapshot: validSnapshot
		});
	});

	test('round-trips through JSON', () => {
		const json = JSON.stringify(validEnvelope);
		const parsed = parseSnapshotEnvelope(JSON.parse(json));
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.snapshot).toEqual(validSnapshot);
		}
	});
});

describe('parseSnapshotEnvelope', () => {
	test('accepts a valid envelope with null draft and routedPath', () => {
		const result = parseSnapshotEnvelope(validEnvelope);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.snapshot).toEqual(validSnapshot);
		}
	});

	test('accepts null draft (an in-progress chain would be required for commission)', () => {
		const env = buildSnapshotEnvelope({ ...validSnapshot, draft: null });
		expect(parseSnapshotEnvelope(env).ok).toBe(true);
	});

	test('accepts a non-null draft', () => {
		const env = buildSnapshotEnvelope({
			...validSnapshot,
			draft: { id: 'draft-1', type: 'polygon', points: [{ lat: 0, lng: 0 }] }
		});
		expect(parseSnapshotEnvelope(env).ok).toBe(true);
	});

	test('accepts a populated routedPath', () => {
		const env = buildSnapshotEnvelope({
			...validSnapshot,
			phase: 'routed',
			routedPath: [
				{ lat: 1, lng: 2 },
				{ lat: 1.1, lng: 2.1 }
			]
		});
		expect(parseSnapshotEnvelope(env).ok).toBe(true);
	});

	test('rejects non-objects', () => {
		expect(parseSnapshotEnvelope(null).ok).toBe(false);
		expect(parseSnapshotEnvelope('hi').ok).toBe(false);
		expect(parseSnapshotEnvelope(42).ok).toBe(false);
		expect(parseSnapshotEnvelope([]).ok).toBe(false);
	});

	test('rejects wrong format', () => {
		const wrong = { format: 'other', version: 1, snapshot: validSnapshot };
		const result = parseSnapshotEnvelope(wrong);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain(SNAPSHOT_FORMAT);
	});

	test('rejects future versions', () => {
		const future = { format: SNAPSHOT_FORMAT, version: 2, snapshot: validSnapshot };
		const result = parseSnapshotEnvelope(future);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('version');
	});

	test('rejects missing snapshot', () => {
		const missing = { format: SNAPSHOT_FORMAT, version: 1 };
		const result = parseSnapshotEnvelope(missing);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('snapshot');
	});

	test('rejects missing shapes array', () => {
		const broken = {
			format: SNAPSHOT_FORMAT,
			version: 1,
			snapshot: { draft: null, phase: 'editing', routedPath: null }
		};
		const result = parseSnapshotEnvelope(broken);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('shapes');
	});

	test('rejects invalid phase', () => {
		const bad = {
			format: SNAPSHOT_FORMAT,
			version: 1,
			snapshot: { shapes: [], draft: null, phase: 'something-else', routedPath: null }
		};
		const result = parseSnapshotEnvelope(bad);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('phase');
	});

	test('rejects a shape with a non-string id', () => {
		const bad = {
			format: SNAPSHOT_FORMAT,
			version: 1,
			snapshot: {
				shapes: [{ id: 42, type: 'pencil', points: [{ lat: 0, lng: 0 }] }],
				draft: null,
				phase: 'editing',
				routedPath: null
			}
		};
		expect(parseSnapshotEnvelope(bad).ok).toBe(false);
	});

	test('rejects a shape with an unknown type', () => {
		const bad = {
			format: SNAPSHOT_FORMAT,
			version: 1,
			snapshot: {
				shapes: [{ id: '1', type: 'squiggle', points: [{ lat: 0, lng: 0 }] }],
				draft: null,
				phase: 'editing',
				routedPath: null
			}
		};
		expect(parseSnapshotEnvelope(bad).ok).toBe(false);
	});

	test('rejects a point with a non-finite lat', () => {
		const bad = {
			format: SNAPSHOT_FORMAT,
			version: 1,
			snapshot: {
				shapes: [{ id: '1', type: 'pencil', points: [{ lat: 'oops', lng: 2 }] }],
				draft: null,
				phase: 'editing',
				routedPath: null
			}
		};
		const result = parseSnapshotEnvelope(bad);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('lat');
	});

	test('rejects a point with NaN lng', () => {
		const bad = {
			format: SNAPSHOT_FORMAT,
			version: 1,
			snapshot: {
				shapes: [{ id: '1', type: 'pencil', points: [{ lat: 1, lng: Number.NaN }] }],
				draft: null,
				phase: 'editing',
				routedPath: null
			}
		};
		expect(parseSnapshotEnvelope(bad).ok).toBe(false);
	});

	test('rejects non-array points within a shape', () => {
		const bad = {
			format: SNAPSHOT_FORMAT,
			version: 1,
			snapshot: {
				shapes: [{ id: '1', type: 'pencil', points: 'nope' }],
				draft: null,
				phase: 'editing',
				routedPath: null
			}
		};
		expect(parseSnapshotEnvelope(bad).ok).toBe(false);
	});
});
