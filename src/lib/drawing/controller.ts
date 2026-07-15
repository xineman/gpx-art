import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
import type { Geometry, Position } from 'geojson';
import type { ToolId } from '$lib/state/tools.svelte';
import { closedPolygon, lineString, rectanglePolygon, shouldSample } from './geo';
import { PREVIEW_SOURCE, previewCollection, setSourceData } from './layers';

export type CommitFn = (geometry: Geometry, tool: string) => void;

type Draft =
	| { kind: 'pencil'; points: Position[] }
	| { kind: 'polyline'; points: Position[]; cursor: Position | null }
	| { kind: 'polygon'; points: Position[]; cursor: Position | null }
	| { kind: 'rectangle'; start: Position; end: Position }
	| null;

/**
 * MapLibre event controller for freehand + vertex drawing tools.
 * Kept framework-agnostic so the Svelte layer stays thin.
 */
export class DrawingController {
	#map: MaplibreMap;
	#commit: CommitFn;
	/** Sticky tool from the panel (may be pan). */
	#tool: ToolId = 'pencil';
	/** True while Space is held or pan tool is selected. */
	#panning = false;
	#draft: Draft = null;
	#pointerDown = false;

	constructor(map: MaplibreMap, commit: CommitFn) {
		this.#map = map;
		this.#commit = commit;
	}

	/** Panel / shortcut selection — cancels draft when the sticky tool changes. */
	setTool(tool: ToolId) {
		if (this.#tool === tool) return;
		this.cancel();
		this.#tool = tool;
		this.#syncMapInteraction();
	}

	/**
	 * Temporary or sticky pan mode. Does not clear an in-progress polyline/polygon
	 * so Space-to-pan can nudge the map mid-draw.
	 */
	setPanning(panning: boolean) {
		if (this.#panning === panning) return;
		this.#panning = panning;
		this.#pointerDown = false;
		this.#syncMapInteraction();
	}

	attach() {
		this.#map.on('mousedown', this.#onMouseDown);
		this.#map.on('mousemove', this.#onMouseMove);
		this.#map.on('mouseup', this.#onMouseUp);
		this.#map.on('click', this.#onClick);
		this.#map.on('dblclick', this.#onDblClick);
		window.addEventListener('keydown', this.#onKeyDown);
		this.#syncMapInteraction();
	}

	detach() {
		this.#map.off('mousedown', this.#onMouseDown);
		this.#map.off('mousemove', this.#onMouseMove);
		this.#map.off('mouseup', this.#onMouseUp);
		this.#map.off('click', this.#onClick);
		this.#map.off('dblclick', this.#onDblClick);
		window.removeEventListener('keydown', this.#onKeyDown);
		this.cancel();
		this.#map.dragPan.enable();
		this.#map.doubleClickZoom.enable();
		this.#map.getCanvas().style.cursor = '';
	}

	cancel() {
		this.#draft = null;
		this.#pointerDown = false;
		this.#clearPreview();
	}

	get #drawTool(): ToolId {
		return this.#panning ? 'pan' : this.#tool;
	}

	#syncMapInteraction() {
		const panning = this.#drawTool === 'pan';
		if (panning) {
			this.#map.dragPan.enable();
			this.#map.doubleClickZoom.enable();
			this.#map.getCanvas().style.cursor = 'grab';
		} else {
			this.#map.dragPan.disable();
			this.#map.doubleClickZoom.disable();
			this.#map.getCanvas().style.cursor = 'crosshair';
		}
	}

	#lngLat(e: MapMouseEvent): Position {
		return [e.lngLat.lng, e.lngLat.lat];
	}

	#onMouseDown = (e: MapMouseEvent) => {
		const tool = this.#drawTool;
		if (tool === 'pan') return;
		// Only primary button
		if (e.originalEvent.button !== 0) return;

		const p = this.#lngLat(e);

		if (tool === 'pencil') {
			this.#pointerDown = true;
			this.#draft = { kind: 'pencil', points: [p] };
			this.#map.dragPan.disable();
			this.#renderPreview();
			e.preventDefault();
		} else if (tool === 'rectangle') {
			this.#pointerDown = true;
			this.#draft = { kind: 'rectangle', start: p, end: p };
			this.#map.dragPan.disable();
			this.#renderPreview();
			e.preventDefault();
		}
	};

	#onMouseMove = (e: MapMouseEvent) => {
		const p = this.#lngLat(e);
		const draft = this.#draft;
		if (!draft) return;

		if (draft.kind === 'pencil' && this.#pointerDown) {
			const last = draft.points[draft.points.length - 1];
			if (shouldSample(last, p)) {
				draft.points.push(p);
				this.#renderPreview();
			}
		} else if (draft.kind === 'rectangle' && this.#pointerDown) {
			draft.end = p;
			this.#renderPreview();
		} else if (draft.kind === 'polyline' || draft.kind === 'polygon') {
			draft.cursor = p;
			this.#renderPreview();
		}
	};

	#onMouseUp = (e: MapMouseEvent) => {
		if (!this.#pointerDown) return;
		this.#pointerDown = false;

		const draft = this.#draft;
		if (!draft) return;

		if (draft.kind === 'pencil') {
			const p = this.#lngLat(e);
			const last = draft.points[draft.points.length - 1];
			if (shouldSample(last, p, 0)) draft.points.push(p);

			if (draft.points.length >= 2) {
				this.#commit(lineString(draft.points), 'pencil');
			}
			this.cancel();
		} else if (draft.kind === 'rectangle') {
			const { start, end } = draft;
			if (start[0] !== end[0] && start[1] !== end[1]) {
				this.#commit(rectanglePolygon(start, end), 'rectangle');
			}
			this.cancel();
		}
	};

	#onClick = (e: MapMouseEvent) => {
		const tool = this.#drawTool;
		if (tool !== 'polyline' && tool !== 'polygon') return;
		// Ignore click that ends a drag from other tools
		if (this.#pointerDown) return;

		const p = this.#lngLat(e);

		if (!this.#draft || this.#draft.kind !== tool) {
			this.#draft =
				tool === 'polyline'
					? { kind: 'polyline', points: [p], cursor: p }
					: { kind: 'polygon', points: [p], cursor: p };
		} else {
			this.#draft.points.push(p);
			this.#draft.cursor = p;
		}
		this.#renderPreview();
	};

	#onDblClick = (e: MapMouseEvent) => {
		const tool = this.#drawTool;
		if (tool !== 'polyline' && tool !== 'polygon') return;
		e.preventDefault();

		const draft = this.#draft;
		if (!draft || (draft.kind !== 'polyline' && draft.kind !== 'polygon')) return;

		// A double-click emits two `click` events first — strip those extras.
		draft.points.splice(-2, 2);

		if (draft.kind === 'polyline' && draft.points.length >= 2) {
			this.#commit(lineString(draft.points), 'polyline');
		} else if (draft.kind === 'polygon' && draft.points.length >= 3) {
			this.#commit(closedPolygon(draft.points), 'polygon');
		}

		this.cancel();
	};

	#onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			this.cancel();
		}
		if (e.key === 'Enter') {
			const draft = this.#draft;
			if (!draft) return;
			if (draft.kind === 'polyline' && draft.points.length >= 2) {
				this.#commit(lineString(draft.points), 'polyline');
				this.cancel();
			} else if (draft.kind === 'polygon' && draft.points.length >= 3) {
				this.#commit(closedPolygon(draft.points), 'polygon');
				this.cancel();
			}
		}
	};

	#renderPreview() {
		const draft = this.#draft;
		if (!draft) {
			this.#clearPreview();
			return;
		}

		let geometry: Geometry | null = null;
		let vertices: [number, number][] = [];

		if (draft.kind === 'pencil') {
			if (draft.points.length >= 2) geometry = lineString(draft.points);
			else if (draft.points[0]) vertices = [draft.points[0] as [number, number]];
		} else if (draft.kind === 'polyline') {
			vertices = draft.points as [number, number][];
			const pts = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
			if (pts.length >= 2) geometry = lineString(pts);
		} else if (draft.kind === 'polygon') {
			vertices = draft.points as [number, number][];
			const pts = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
			if (pts.length >= 3) geometry = closedPolygon(pts);
			else if (pts.length === 2) geometry = lineString(pts);
		} else if (draft.kind === 'rectangle') {
			geometry = rectanglePolygon(draft.start, draft.end);
			vertices = [draft.start as [number, number], draft.end as [number, number]];
		}

		setSourceData(this.#map, PREVIEW_SOURCE, previewCollection(geometry, vertices));
	}

	#clearPreview() {
		setSourceData(this.#map, PREVIEW_SOURCE, previewCollection(null));
	}
}
