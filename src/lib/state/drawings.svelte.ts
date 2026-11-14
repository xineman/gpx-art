import type { Feature, FeatureCollection, Geometry } from 'geojson';

export type DrawingFeature = Feature<Geometry, { tool: string; id: string }>;

/**
 * Completed drawings as a GeoJSON FeatureCollection.
 * DrawingLayer keeps MapLibre sources in sync with this list.
 *
 * Snapshot undo/redo: each mutating action stores the previous full feature
 * list so bulk ops (import replace) undo in one step. Draft strokes still use Escape.
 */
class DrawingsState {
	#features = $state<DrawingFeature[]>([]);
	/** Previous feature lists, oldest first. */
	#past = $state<DrawingFeature[][]>([]);
	/** Future feature lists for redo, oldest first. */
	#future = $state<DrawingFeature[][]>([]);
	/** Increments for every committed sketch mutation. */
	#revision = $state(0);

	#commit(next: DrawingFeature[]) {
		this.#past = [...this.#past, this.#features];
		this.#features = next;
		this.#future = [];
		this.#revision += 1;
	}

	get features() {
		return this.#features;
	}
	get revision() {
		return this.#revision;
	}
	get collection(): FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: this.#features
		};
	}
	get canUndo() {
		return this.#past.length > 0;
	}
	get canRedo() {
		return this.#future.length > 0;
	}
	add(geometry: Geometry, tool: string) {
		const id = crypto.randomUUID();
		const feature: DrawingFeature = {
			type: 'Feature',
			id,
			properties: { tool, id },
			geometry
		};
		this.#commit([...this.#features, feature]);
		return feature;
	}
	/**
	 * Replace the entire canvas in one undoable step (e.g. GeoJSON import).
	 * Always commits, including empty → imported and imported → empty.
	 */
	replaceAll(next: DrawingFeature[]) {
		this.#commit(next);
	}
	undo() {
		if (this.#past.length === 0) return;
		const previous = this.#past[this.#past.length - 1]!;
		this.#future = [...this.#future, this.#features];
		this.#past = this.#past.slice(0, -1);
		this.#features = previous;
		this.#revision += 1;
	}
	redo() {
		if (this.#future.length === 0) return;
		const next = this.#future[this.#future.length - 1]!;
		this.#past = [...this.#past, this.#features];
		this.#future = this.#future.slice(0, -1);
		this.#features = next;
		this.#revision += 1;
	}
	/**
	 * Remove all shapes in one undoable step (toolbar Clear).
	 * No-op when already empty so history stays clean.
	 */
	clearSketch() {
		if (this.#features.length === 0) return;
		this.#commit([]);
	}
	/** Hard reset — features and undo stacks. Prefer clearSketch() for UI. */
	clear() {
		this.#features = [];
		this.#past = [];
		this.#future = [];
		this.#revision += 1;
	}
	remove(id: string) {
		const next = this.#features.filter((f) => f.properties.id !== id);
		if (next.length === this.#features.length) return;
		// Non-baseline wipe of one id — still one history step so stacks stay coherent.
		this.#commit(next);
	}
}

export const drawings = new DrawingsState();
