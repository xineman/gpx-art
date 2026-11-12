import type { Geometry } from 'geojson';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { ToolId } from '#lib/state/tools.svelte.js';
import { projectDraft, type DraftSnapshot } from './draft';
import { PREVIEW_SOURCE, previewCollection, setSourceData } from './layers';
import { MapDrawingInput } from './map-input';
import { DrawingSession, type DrawingEvent } from './session';
import { toLngLat } from './tap';

export type { DraftSnapshot } from './draft';
export type CommitFn = (geometry: Geometry, tool: string) => void;
export type DraftChangeFn = (draft: DraftSnapshot | null) => void;

/** Connects drawing input and session effects to MapLibre and the editor. */
export class DrawingController {
	#map: MaplibreMap;
	#commit: CommitFn;
	#onDraftChange: DraftChangeFn | undefined;
	#session: DrawingSession;
	#input: MapDrawingInput;

	constructor(map: MaplibreMap, commit: CommitFn, onDraftChange?: DraftChangeFn) {
		this.#map = map;
		this.#commit = commit;
		this.#onDraftChange = onDraftChange;
		this.#session = new DrawingSession((position) => map.project(toLngLat(position)));
		this.#input = new MapDrawingInput(map, (event, original) => this.#dispatch(event, original));
	}

	setTool(tool: ToolId) {
		this.#dispatch({ type: 'selectTool', tool });
	}

	setPanning(enabled: boolean) {
		this.#dispatch({ type: 'setPanning', enabled });
	}

	attach() {
		this.#input.attach();
		this.#syncMapInteraction();
	}

	detach() {
		this.#input.detach();
		this.cancel();
		this.#map.dragPan.enable();
		this.#map.doubleClickZoom.enable();
		this.#map.getCanvas().style.cursor = '';
	}

	cancel() {
		this.#dispatch({ type: 'cancel' });
	}

	#dispatch(event: DrawingEvent, original?: Pick<Event, 'preventDefault'>) {
		const previousPointer = this.#session.activePointer;
		const update = this.#session.dispatch(event);
		if (!update) return;

		if (update.consume) original?.preventDefault();
		const pointer = this.#session.activePointer;
		if (pointer !== previousPointer) this.#input.capture(pointer);

		if (update.commit) this.#commit(update.commit.geometry, update.commit.tool);
		if (update.previewChanged) this.#renderDraft();
		if (update.interactionChanged) this.#syncMapInteraction();
	}

	#renderDraft() {
		const { geometry, vertices, snapshot } = projectDraft(this.#session.draft);
		setSourceData(this.#map, PREVIEW_SOURCE, previewCollection(geometry, vertices));
		this.#onDraftChange?.(snapshot);
	}

	#syncMapInteraction() {
		if (this.#session.panning) {
			this.#map.dragPan.enable();
			this.#map.doubleClickZoom.enable();
			this.#map.getCanvas().style.cursor = 'grab';
		} else {
			this.#map.dragPan.disable();
			this.#map.doubleClickZoom.disable();
			this.#map.getCanvas().style.cursor = 'crosshair';
		}
	}
}
