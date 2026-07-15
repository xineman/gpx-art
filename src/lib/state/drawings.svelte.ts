import type { Feature, FeatureCollection, Geometry } from 'geojson';

export type DrawingFeature = Feature<Geometry, { tool: string; id: string }>;

/**
 * Completed drawings as a GeoJSON FeatureCollection.
 * DrawingLayer keeps MapLibre sources in sync with this list.
 *
 * Linear undo/redo for committed features only (draft strokes use Escape).
 */
let features = $state<DrawingFeature[]>([]);
/** Features removed by undo, most recent at the end. */
let redoStack = $state<DrawingFeature[]>([]);

export const drawings = {
	get features() {
		return features;
	},
	get collection(): FeatureCollection {
		return {
			type: 'FeatureCollection',
			features
		};
	},
	get canUndo() {
		return features.length > 0;
	},
	get canRedo() {
		return redoStack.length > 0;
	},
	add(geometry: Geometry, tool: string) {
		const id = crypto.randomUUID();
		const feature: DrawingFeature = {
			type: 'Feature',
			id,
			properties: { tool, id },
			geometry
		};
		features = [...features, feature];
		// New branch discards redo history (standard linear undo).
		redoStack = [];
		return feature;
	},
	undo() {
		if (features.length === 0) return null;
		const last = features[features.length - 1]!;
		features = features.slice(0, -1);
		redoStack = [...redoStack, last];
		return last;
	},
	redo() {
		if (redoStack.length === 0) return null;
		const next = redoStack[redoStack.length - 1]!;
		redoStack = redoStack.slice(0, -1);
		features = [...features, next];
		return next;
	},
	clear() {
		features = [];
		redoStack = [];
	},
	remove(id: string) {
		features = features.filter((f) => f.properties.id !== id);
		// Non-undoable mutation — drop redo so stacks stay consistent.
		redoStack = [];
	}
};
