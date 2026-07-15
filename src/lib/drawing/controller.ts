import type { Map as MaplibreMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import type { Geometry, Position } from 'geojson';
import type { ToolId } from '$lib/state/tools.svelte';
import { closedPolygon, lineString, rectanglePolygon, shouldSample } from './geo';
import { PREVIEW_SOURCE, previewCollection, setSourceData } from './layers';
import { resolveVertexClick, toLngLat, type ScreenPoint } from './tap';

export type CommitFn = (geometry: Geometry, tool: string) => void;

export type DraftSnapshot = {
	tool: ToolId;
	geometry: Geometry | null;
	/** Committed vertices in the open draft (excludes cursor rubber-band). */
	vertexCount: number;
	/** Enough vertices to finish via double-tap / Enter / re-tap last. */
	canFinish: boolean;
};

/** Live draft snapshot for status / stats UI. `null` when idle. */
export type DraftChangeFn = (draft: DraftSnapshot | null) => void;

type Draft =
	| { kind: 'pencil'; points: Position[] }
	| { kind: 'polyline'; points: Position[]; cursor: Position | null }
	| { kind: 'polygon'; points: Position[]; cursor: Position | null }
	| { kind: 'rectangle'; start: Position; end: Position }
	| null;

type PointerKind = 'mouse' | 'touch';

/**
 * MapLibre event controller for freehand + vertex drawing tools.
 * Kept framework-agnostic so the Svelte layer stays thin.
 *
 * Drag tools (pencil / rectangle) listen to **both** mouse and touch —
 * touch devices often never emit a usable mousedown→mousemove→mouseup
 * chain for continuous strokes.
 *
 * Layout (top → bottom): public API → interaction mode → drag workflow
 * (shared core → map entry → window capture) → vertex workflow → draft
 * output → pure coordinate helpers.
 */
export class DrawingController {
	#map: MaplibreMap;
	#commit: CommitFn;
	#onDraftChange: DraftChangeFn | undefined;
	/** Sticky tool from the panel (may be pan). */
	#tool: ToolId = 'pencil';
	/** True while Space is held or pan tool is selected. */
	#panning = false;
	#draft: Draft = null;
	/** True while a pencil/rectangle stroke is held. */
	#pointerDown = false;
	/** Which input started the current drag stroke (avoids double-firing). */
	#activePointer: PointerKind | null = null;
	/**
	 * Last vertex-place click — used for double-tap finish.
	 * Touch devices often never emit MapLibre `dblclick`, so we detect
	 * a second same-spot tap in the click handler.
	 */
	#lastTap: { t: number; screen: ScreenPoint } | null = null;
	/** Window listeners active during a touch stroke (finger can leave the canvas). */
	#windowTouchBound = false;
	/** Window listeners active during a mouse stroke (cursor can leave the canvas). */
	#windowMouseBound = false;

	// ─── Public API ────────────────────────────────────────────────────

	constructor(map: MaplibreMap, commit: CommitFn, onDraftChange?: DraftChangeFn) {
		this.#map = map;
		this.#commit = commit;
		this.#onDraftChange = onDraftChange;
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
		if (this.#pointerDown) {
			// Drop an incomplete drag stroke when switching to pan mid-gesture.
			this.#pointerDown = false;
			this.#activePointer = null;
			this.#unbindWindowPointer();
			if (this.#draft?.kind === 'pencil' || this.#draft?.kind === 'rectangle') {
				this.cancel();
			}
		}
		this.#syncMapInteraction();
	}

	attach() {
		this.#map.on('mousedown', this.#onMouseDown);
		this.#map.on('mousemove', this.#onMouseMove);
		this.#map.on('mouseup', this.#onMouseUp);
		this.#map.on('touchstart', this.#onTouchStart);
		this.#map.on('touchmove', this.#onTouchMove);
		this.#map.on('touchend', this.#onTouchEnd);
		this.#map.on('touchcancel', this.#onTouchCancel);
		this.#map.on('click', this.#onClick);
		// Backup for browsers that still emit a real dblclick after two clicks.
		this.#map.on('dblclick', this.#onDblClick);
		window.addEventListener('keydown', this.#onKeyDown);
		this.#syncMapInteraction();
	}

	detach() {
		this.#map.off('mousedown', this.#onMouseDown);
		this.#map.off('mousemove', this.#onMouseMove);
		this.#map.off('mouseup', this.#onMouseUp);
		this.#map.off('touchstart', this.#onTouchStart);
		this.#map.off('touchmove', this.#onTouchMove);
		this.#map.off('touchend', this.#onTouchEnd);
		this.#map.off('touchcancel', this.#onTouchCancel);
		this.#map.off('click', this.#onClick);
		this.#map.off('dblclick', this.#onDblClick);
		window.removeEventListener('keydown', this.#onKeyDown);
		this.#unbindWindowPointer();
		this.cancel();
		this.#map.dragPan.enable();
		this.#map.doubleClickZoom.enable();
		this.#map.getCanvas().style.cursor = '';
	}

	cancel() {
		this.#draft = null;
		this.#pointerDown = false;
		this.#activePointer = null;
		this.#lastTap = null;
		this.#unbindWindowPointer();
		this.#clearPreview();
		this.#publishDraft();
	}

	// ─── Interaction mode ──────────────────────────────────────────────

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

	// ─── Drag workflow (pencil / rectangle) ────────────────────────────
	// Shared core → map entry points → window capture when pointer leaves map.

	#beginDragStroke(tool: ToolId, p: Position, kind: PointerKind) {
		if (tool !== 'pencil' && tool !== 'rectangle') return false;

		this.#pointerDown = true;
		this.#activePointer = kind;
		this.#draft =
			tool === 'pencil' ? { kind: 'pencil', points: [p] } : { kind: 'rectangle', start: p, end: p };
		this.#map.dragPan.disable();
		if (kind === 'touch') this.#bindWindowTouch();
		else this.#bindWindowMouse();
		this.#renderPreview();
		return true;
	}

	#updateDragStroke(p: Position) {
		const draft = this.#draft;
		if (!draft || !this.#pointerDown) return;

		if (draft.kind === 'pencil') {
			const last = draft.points[draft.points.length - 1];
			if (shouldSample(last, p)) {
				draft.points.push(p);
				this.#renderPreview();
			}
		} else if (draft.kind === 'rectangle') {
			draft.end = p;
			this.#renderPreview();
		}
	}

	#endDragStroke(p: Position | null) {
		if (!this.#pointerDown) return;
		this.#pointerDown = false;
		this.#activePointer = null;
		this.#unbindWindowPointer();

		const draft = this.#draft;
		if (!draft) return;

		if (draft.kind === 'pencil') {
			if (p) {
				const last = draft.points[draft.points.length - 1];
				if (shouldSample(last, p, 0)) draft.points.push(p);
			}
			if (draft.points.length >= 2) {
				this.#commit(lineString(draft.points), 'pencil');
			}
			this.cancel();
		} else if (draft.kind === 'rectangle') {
			if (p) draft.end = p;
			const { start, end } = draft;
			if (start[0] !== end[0] && start[1] !== end[1]) {
				this.#commit(rectanglePolygon(start, end), 'rectangle');
			}
			this.cancel();
		}
	}

	// Map: start / update / end while pointer is on the canvas.

	#onMouseDown = (e: MapMouseEvent) => {
		const tool = this.#drawTool;
		if (tool === 'pan') return;
		// Ignore secondary buttons; allow button 0 and touch-emulated (0).
		if (e.originalEvent.button !== 0) return;
		// A live touch stroke owns the gesture — ignore compatibility mouse events.
		if (this.#activePointer === 'touch') return;

		const p = this.#lngLatFromMouse(e);
		if (this.#beginDragStroke(tool, p, 'mouse')) {
			e.preventDefault();
		}
	};

	#onMouseMove = (e: MapMouseEvent) => {
		const p = this.#lngLatFromMouse(e);
		const draft = this.#draft;

		if (this.#activePointer === 'mouse' && this.#pointerDown) {
			this.#updateDragStroke(p);
			return;
		}

		// Rubber-band cursor for vertex tools (mouse only; touch has no hover).
		if (draft && (draft.kind === 'polyline' || draft.kind === 'polygon')) {
			draft.cursor = p;
			this.#renderPreview();
		}
	};

	#onMouseUp = (e: MapMouseEvent) => {
		if (this.#activePointer !== 'mouse') return;
		this.#endDragStroke(this.#lngLatFromMouse(e));
	};

	#onTouchStart = (e: MapTouchEvent) => {
		const tool = this.#drawTool;
		if (tool === 'pan') return;

		// Multi-touch: cancel an in-progress drag so pinch-zoom isn't fought.
		if (e.points.length !== 1) {
			if (this.#pointerDown && this.#activePointer === 'touch') {
				this.cancel();
			}
			return;
		}

		if (tool !== 'pencil' && tool !== 'rectangle') return;
		if (this.#activePointer === 'mouse') return;

		const p = this.#lngLatFromTouch(e);
		if (!p) return;

		if (this.#beginDragStroke(tool, p, 'touch')) {
			// Blocks residual pan and suppresses delayed synthetic mouse events.
			e.preventDefault();
		}
	};

	#onTouchMove = (e: MapTouchEvent) => {
		if (this.#activePointer !== 'touch' || !this.#pointerDown) return;
		const p = this.#lngLatFromTouch(e);
		if (!p) return;
		e.preventDefault();
		this.#updateDragStroke(p);
	};

	#onTouchEnd = (e: MapTouchEvent) => {
		if (this.#activePointer !== 'touch' || !this.#pointerDown) return;
		// Another finger still down — keep the stroke until full lift.
		if (e.originalEvent.touches.length > 0) return;
		const p = this.#lngLatFromTouch(e);
		this.#endDragStroke(p);
	};

	#onTouchCancel = () => {
		if (this.#activePointer !== 'touch') return;
		// Interrupted gesture — drop incomplete stroke rather than commit a stub.
		if (this.#pointerDown) {
			this.cancel();
		}
	};

	// Window: keep drag alive after pointer leaves the map canvas.

	#bindWindowTouch() {
		if (this.#windowTouchBound) return;
		this.#windowTouchBound = true;
		// passive: false so we can preventDefault and stop the page from scrolling.
		window.addEventListener('touchmove', this.#onWindowTouchMove, { passive: false });
		window.addEventListener('touchend', this.#onWindowTouchEnd);
		window.addEventListener('touchcancel', this.#onWindowTouchEnd);
	}

	#unbindWindowTouch() {
		if (!this.#windowTouchBound) return;
		this.#windowTouchBound = false;
		window.removeEventListener('touchmove', this.#onWindowTouchMove);
		window.removeEventListener('touchend', this.#onWindowTouchEnd);
		window.removeEventListener('touchcancel', this.#onWindowTouchEnd);
	}

	#bindWindowMouse() {
		if (this.#windowMouseBound) return;
		this.#windowMouseBound = true;
		window.addEventListener('mousemove', this.#onWindowMouseMove);
		window.addEventListener('mouseup', this.#onWindowMouseUp);
	}

	#unbindWindowMouse() {
		if (!this.#windowMouseBound) return;
		this.#windowMouseBound = false;
		window.removeEventListener('mousemove', this.#onWindowMouseMove);
		window.removeEventListener('mouseup', this.#onWindowMouseUp);
	}

	#unbindWindowPointer() {
		this.#unbindWindowTouch();
		this.#unbindWindowMouse();
	}

	#onWindowTouchMove = (ev: TouchEvent) => {
		if (this.#activePointer !== 'touch' || !this.#pointerDown) return;
		ev.preventDefault();
		const p = this.#positionFromTouchEvent(ev);
		if (p) this.#updateDragStroke(p);
	};

	#onWindowTouchEnd = (ev: TouchEvent) => {
		if (this.#activePointer !== 'touch' || !this.#pointerDown) return;
		// Still touching with another finger — wait for full lift.
		if (ev.touches.length > 0) return;
		const p = this.#positionFromTouchEvent(ev);
		this.#endDragStroke(p);
	};

	#onWindowMouseMove = (ev: MouseEvent) => {
		if (this.#activePointer !== 'mouse' || !this.#pointerDown) return;
		this.#updateDragStroke(this.#positionFromClient(ev.clientX, ev.clientY));
	};

	#onWindowMouseUp = (ev: MouseEvent) => {
		if (this.#activePointer !== 'mouse' || !this.#pointerDown) return;
		this.#endDragStroke(this.#positionFromClient(ev.clientX, ev.clientY));
	};

	// ─── Vertex workflow (polyline / polygon) ──────────────────────────

	#onClick = (e: MapMouseEvent) => {
		const tool = this.#drawTool;
		if (tool !== 'polyline' && tool !== 'polygon') return;
		// Ignore click that ends a drag from other tools
		if (this.#pointerDown) return;

		const p = this.#lngLatFromMouse(e);
		const now = performance.now();
		const screen = this.#screenOf(p);
		const draft = this.#draft;

		if (draft && (draft.kind === 'polyline' || draft.kind === 'polygon')) {
			const last = draft.points[draft.points.length - 1];
			const action = resolveVertexClick({
				canFinish: this.#canFinish(draft),
				lastVertexScreen: last ? this.#screenOf(last) : null,
				screen,
				lastTap: this.#lastTap,
				now
			});

			if (action === 'finish-last') {
				e.preventDefault();
				this.#finishVertexDraft();
				return;
			}

			if (action === 'finish-double-tap-undo') {
				e.preventDefault();
				// First half of the pair already placed a vertex — undo it, then finish.
				const removed = draft.points.pop();
				if (this.#canFinish(draft)) {
					this.#finishVertexDraft();
				} else {
					// Too few points: restore so we never silently shrink the draft.
					if (removed) draft.points.push(removed);
					this.#lastTap = null;
					this.#renderPreview();
				}
				return;
			}
		}

		if (!this.#draft || this.#draft.kind !== tool) {
			this.#draft =
				tool === 'polyline'
					? { kind: 'polyline', points: [p], cursor: p }
					: { kind: 'polygon', points: [p], cursor: p };
		} else {
			this.#draft.points.push(p);
			this.#draft.cursor = p;
		}
		this.#lastTap = { t: now, screen };
		this.#renderPreview();
	};

	#onDblClick = (e: MapMouseEvent) => {
		const tool = this.#drawTool;
		if (tool !== 'polyline' && tool !== 'polygon') return;
		e.preventDefault();

		// Prefer the click-based double-tap path. If a browser still fires dblclick
		// after two clicks, the draft may already be finished/cancelled.
		const draft = this.#draft;
		if (!draft || (draft.kind !== 'polyline' && draft.kind !== 'polygon')) return;

		// Fallback: classic desktop dblclick (two click vertices already appended).
		const removed = draft.points.splice(-2, 2);
		if (this.#canFinish(draft)) {
			this.#finishVertexDraft();
		} else {
			draft.points.push(...removed);
			this.#lastTap = null;
			this.#renderPreview();
		}
	};

	#onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			this.cancel();
		}
		if (e.key === 'Enter') {
			this.#finishVertexDraft();
		}
	};

	/** Commit open polyline/polygon when vertex count allows. */
	#finishVertexDraft() {
		const draft = this.#draft;
		if (!draft) return;

		if (draft.kind === 'polyline' && draft.points.length >= 2) {
			this.#commit(lineString(draft.points), 'polyline');
			this.cancel();
		} else if (draft.kind === 'polygon' && draft.points.length >= 3) {
			this.#commit(closedPolygon(draft.points), 'polygon');
			this.cancel();
		} else {
			// Not enough points — clear the double-tap timer so the next tap adds.
			this.#lastTap = null;
			this.#renderPreview();
		}
	}

	// ─── Draft output (preview layers + status) ────────────────────────

	#renderPreview() {
		const draft = this.#draft;
		if (!draft) {
			this.#clearPreview();
			this.#publishDraft();
			return;
		}

		const { geometry, vertices } = this.#draftVisual(draft);
		setSourceData(this.#map, PREVIEW_SOURCE, previewCollection(geometry, vertices));
		this.#publishDraft();
	}

	#clearPreview() {
		setSourceData(this.#map, PREVIEW_SOURCE, previewCollection(null));
	}

	#publishDraft() {
		if (!this.#onDraftChange) return;
		const draft = this.#draft;
		if (!draft) {
			this.#onDraftChange(null);
			return;
		}
		this.#onDraftChange({
			tool: draft.kind,
			geometry: this.#draftStatsGeometry(draft),
			vertexCount: this.#vertexCount(draft),
			canFinish: this.#canFinish(draft)
		});
	}

	/** MapLibre paint payload. */
	#draftVisual(draft: NonNullable<Draft>): {
		geometry: Geometry | null;
		vertices: [number, number][];
	} {
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

		return { geometry, vertices };
	}

	/** Geometry for distance / point stats (Point when only a vertex exists). */
	#draftStatsGeometry(draft: NonNullable<Draft>): Geometry | null {
		const { geometry, vertices } = this.#draftVisual(draft);
		if (geometry) return geometry;
		const first = vertices[0];
		if (first) return { type: 'Point', coordinates: first };
		return null;
	}

	#vertexCount(draft: NonNullable<Draft>): number {
		if (draft.kind === 'pencil') return draft.points.length;
		if (draft.kind === 'polyline' || draft.kind === 'polygon') return draft.points.length;
		if (draft.kind === 'rectangle') return 2;
		return 0;
	}

	#canFinish(draft: NonNullable<Draft>): boolean {
		if (draft.kind === 'polyline') return draft.points.length >= 2;
		if (draft.kind === 'polygon') return draft.points.length >= 3;
		return false;
	}

	// ─── Coordinate helpers ────────────────────────────────────────────

	#lngLatFromMouse(e: MapMouseEvent): Position {
		return [e.lngLat.lng, e.lngLat.lat];
	}

	#lngLatFromTouch(e: MapTouchEvent): Position | null {
		// Prefer the primary/remaining touch; center is fine for single-finger.
		const ll = e.lngLat ?? e.lngLats[0];
		if (!ll) return null;
		return [ll.lng, ll.lat];
	}

	#positionFromClient(clientX: number, clientY: number): Position {
		const rect = this.#map.getCanvas().getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		const ll = this.#map.unproject([x, y]);
		return [ll.lng, ll.lat];
	}

	#positionFromTouchEvent(ev: TouchEvent): Position | null {
		const t = ev.changedTouches[0] ?? ev.touches[0];
		if (!t) return null;
		return this.#positionFromClient(t.clientX, t.clientY);
	}

	#screenOf(point: Position): ScreenPoint {
		const p = this.#map.project(toLngLat(point));
		return { x: p.x, y: p.y };
	}
}
