import { afterEach, describe, expect, it } from 'vitest';
import type { Geometry } from 'geojson';
import { drawings } from './drawings.svelte';

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

		const undone = drawings.undo();
		expect(undone?.properties.id).toBeDefined();
		expect(drawings.features).toHaveLength(1);
		expect(drawings.features[0]!.properties.id).toBe(a.properties.id);
		expect(drawings.canUndo).toBe(true);
		expect(drawings.canRedo).toBe(true);
	});

	it('redo restores the same feature id and geometry', () => {
		const a = drawings.add(lineA, 'polyline');
		const undone = drawings.undo();
		expect(undone?.properties.id).toBe(a.properties.id);
		expect(drawings.features).toHaveLength(0);

		const redone = drawings.redo();
		expect(redone?.properties.id).toBe(a.properties.id);
		expect(redone?.geometry).toEqual(lineA);
		expect(drawings.features).toHaveLength(1);
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
		expect(drawings.undo()).toBeNull();
		expect(drawings.redo()).toBeNull();
		expect(drawings.features).toEqual([]);
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
