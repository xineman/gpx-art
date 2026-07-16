import { afterEach, describe, expect, it } from 'vitest';
import type { Geometry } from 'geojson';
import { drawings, type DrawingFeature } from './drawings.svelte';

const lineA: Geometry = {
	type: 'LineString',
	coordinates: [
		[21.0, 52.2],
		[21.01, 52.21]
	]
};

const lineB: Geometry = {
	type: 'LineString',
	coordinates: [
		[21.02, 52.22],
		[21.03, 52.23]
	]
};

const lineC: Geometry = {
	type: 'LineString',
	coordinates: [
		[21.04, 52.24],
		[21.05, 52.25]
	]
};

function feature(geometry: Geometry, tool: string, id: string): DrawingFeature {
	return {
		type: 'Feature',
		id,
		properties: { tool, id },
		geometry
	};
}

afterEach(() => {
	drawings.clear();
});

describe('drawings history', () => {
	it('starts with empty stacks', () => {
		expect(drawings.features).toEqual([]);
		expect(drawings.canUndo).toBe(false);
		expect(drawings.canRedo).toBe(false);
	});

	it('add enables undo and clears redo', () => {
		const a = drawings.add(lineA, 'polyline');
		expect(drawings.features).toHaveLength(1);
		expect(drawings.canUndo).toBe(true);
		expect(drawings.canRedo).toBe(false);
		expect(a.properties.tool).toBe('polyline');
	});

	it('undo removes the last feature and enables redo', () => {
		const a = drawings.add(lineA, 'polyline');
		drawings.add(lineB, 'pencil');
		expect(drawings.features).toHaveLength(2);

		drawings.undo();
		expect(drawings.features).toHaveLength(1);
		expect(drawings.features[0]!.properties.id).toBe(a.properties.id);
		expect(drawings.canUndo).toBe(true);
		expect(drawings.canRedo).toBe(true);
	});

	it('redo restores the same feature id and geometry', () => {
		const a = drawings.add(lineA, 'polyline');
		drawings.undo();
		expect(drawings.features).toHaveLength(0);

		drawings.redo();
		expect(drawings.features).toHaveLength(1);
		expect(drawings.features[0]!.properties.id).toBe(a.properties.id);
		expect(drawings.features[0]!.geometry).toEqual(lineA);
		expect(drawings.canRedo).toBe(false);
		expect(drawings.canUndo).toBe(true);
	});

	it('add after undo clears the redo stack', () => {
		drawings.add(lineA, 'polyline');
		drawings.undo();
		expect(drawings.canRedo).toBe(true);

		drawings.add(lineB, 'rectangle');
		expect(drawings.canRedo).toBe(false);
		expect(drawings.features).toHaveLength(1);
		expect(drawings.features[0]!.properties.tool).toBe('rectangle');
	});

	it('undo/redo are no-ops on empty stacks', () => {
		drawings.undo();
		drawings.redo();
		expect(drawings.features).toEqual([]);
		expect(drawings.canUndo).toBe(false);
		expect(drawings.canRedo).toBe(false);
	});

	it('clear resets features and redo', () => {
		drawings.add(lineA, 'polyline');
		drawings.undo();
		expect(drawings.canRedo).toBe(true);

		drawings.clear();
		expect(drawings.features).toEqual([]);
		expect(drawings.canUndo).toBe(false);
		expect(drawings.canRedo).toBe(false);
	});

	it('clearSketch empties features in one undoable step', () => {
		const a = drawings.add(lineA, 'polyline');
		drawings.add(lineB, 'pencil');
		expect(drawings.features).toHaveLength(2);

		drawings.clearSketch();
		expect(drawings.features).toEqual([]);
		expect(drawings.canUndo).toBe(true);
		expect(drawings.canRedo).toBe(false);

		drawings.undo();
		expect(drawings.features).toHaveLength(2);
		expect(drawings.features[0]!.properties.id).toBe(a.properties.id);
	});

	it('clearSketch is a no-op when empty', () => {
		drawings.clearSketch();
		expect(drawings.features).toEqual([]);
		expect(drawings.canUndo).toBe(false);
	});

	it('increments revision for every committed sketch change', () => {
		const initialRevision = drawings.revision;
		drawings.add(lineA, 'polyline');
		expect(drawings.revision).toBe(initialRevision + 1);

		drawings.undo();
		expect(drawings.revision).toBe(initialRevision + 2);

		drawings.redo();
		expect(drawings.revision).toBe(initialRevision + 3);

		drawings.clearSketch();
		expect(drawings.revision).toBe(initialRevision + 4);
	});

	it('remove drops redo history', () => {
		const a = drawings.add(lineA, 'polyline');
		drawings.add(lineB, 'pencil');
		drawings.undo();
		expect(drawings.canRedo).toBe(true);

		drawings.remove(a.properties.id);
		expect(drawings.features).toHaveLength(0);
		expect(drawings.canRedo).toBe(false);
	});
});

describe('drawings.replaceAll', () => {
	it('replaces features in one undoable step', () => {
		const a = drawings.add(lineA, 'polyline');
		drawings.add(lineB, 'pencil');
		expect(drawings.features).toHaveLength(2);

		const imported = [feature(lineC, 'imported', 'import-1')];
		drawings.replaceAll(imported);

		expect(drawings.features).toEqual(imported);
		expect(drawings.canUndo).toBe(true);

		drawings.undo();
		expect(drawings.features).toHaveLength(2);
		expect(drawings.features[0]!.properties.id).toBe(a.properties.id);
		expect(drawings.canRedo).toBe(true);

		drawings.redo();
		expect(drawings.features).toEqual(imported);
	});

	it('can undo empty → imported back to empty', () => {
		const imported = [feature(lineA, 'imported', 'only')];
		drawings.replaceAll(imported);
		expect(drawings.features).toHaveLength(1);
		expect(drawings.canUndo).toBe(true);

		drawings.undo();
		expect(drawings.features).toEqual([]);
		expect(drawings.canRedo).toBe(true);
	});

	it('replaceAll after undo clears redo', () => {
		drawings.add(lineA, 'polyline');
		drawings.undo();
		expect(drawings.canRedo).toBe(true);

		drawings.replaceAll([feature(lineB, 'imported', 'x')]);
		expect(drawings.canRedo).toBe(false);
		expect(drawings.features).toHaveLength(1);
	});
});
