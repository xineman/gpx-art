import type { Feature, FeatureCollection, Geometry } from 'geojson';

export type DrawingFeature = Feature<Geometry, { tool: string; id: string }>;

/**
 * Completed drawings as a GeoJSON FeatureCollection.
 * DrawingLayer keeps MapLibre sources in sync with this list.
 *
 * Snapshot undo/redo: each mutating action stores the previous full feature
 * list so bulk ops (import replace) undo in one step. Draft strokes still use Escape.
 */
let features = $state<DrawingFeature[]>([]);
/** Previous feature lists, oldest first. */
let past = $state<DrawingFeature[][]>([]);
/** Future feature lists for redo, oldest first. */
let future = $state<DrawingFeature[][]>([]);
/** Increments for every committed sketch mutation. */
let revision = $state(0);

function commit(next: DrawingFeature[]) {
	past = [...past, features];
	features = next;
	future = [];
	revision += 1;
}

export const drawings = {
	get features() {
		return features;
	},
	get revision() {
		return revision;
	},
	get collection(): FeatureCollection {
		return {
			type: 'FeatureCollection',
			features
		};
	},
	get canUndo() {
		return past.length > 0;
	},
	get canRedo() {
		return future.length > 0;
	},
	add(geometry: Geometry, tool: string) {
		const id = crypto.randomUUID();
		const feature: DrawingFeature = {
			type: 'Feature',
			id,
			properties: { tool, id },
			geometry
		};
		commit([...features, feature]);
		return feature;
	},
	/**
	 * Replace the entire canvas in one undoable step (e.g. GeoJSON import).
	 * Always commits, including empty → imported and imported → empty.
	 */
	replaceAll(next: DrawingFeature[]) {
		commit(next);
	},
	undo() {
		if (past.length === 0) return;
		const previous = past[past.length - 1]!;
		future = [...future, features];
		past = past.slice(0, -1);
		features = previous;
		revision += 1;
	},
	redo() {
		if (future.length === 0) return;
		const next = future[future.length - 1]!;
		past = [...past, features];
		future = future.slice(0, -1);
		features = next;
		revision += 1;
	},
	/**
	 * Remove all shapes in one undoable step (toolbar Clear).
	 * No-op when already empty so history stays clean.
	 */
	clearSketch() {
		if (features.length === 0) return;
		commit([]);
	},
	/** Hard reset — features and undo stacks. Prefer clearSketch() for UI. */
	clear() {
		features = [];
		past = [];
		future = [];
		revision += 1;
	},
	remove(id: string) {
		const next = features.filter((f) => f.properties.id !== id);
		if (next.length === features.length) return;
		// Non-baseline wipe of one id — still one history step so stacks stay coherent.
		commit(next);
	}
};
