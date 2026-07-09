import { SvelteDate } from 'svelte/reactivity';
import type * as Leaflet from 'leaflet';
import { distanceBetween } from '$lib/geometry/distance';
import { rectanglePoints, resizeRectangle, toPoint } from '$lib/geometry/point';
import { buildRoutePlan, type RouteDebugBatch } from '$lib/routing/batchPlan';
import { pointsToGpx } from '$lib/routing/gpx';
import { cleanRoutedPathOnNetwork } from '$lib/routing/cleanPath';
import { getRoute, type RouteResult } from '$lib/routing/osrm';
import { decodePolyline } from '$lib/routing/polyline';
import {
	clampCornerInset,
	CORNER_INSET_DEFAULT_METERS,
	isRouteFidelity,
	resolveRoutingOptions,
	type RouteFidelity,
	type RoutingOptions
} from '$lib/routing/options';
import { isClosedShapeType, prepareShapeRoute, routePreparedStructured } from '$lib/routing/pipeline';
import {
	buildFlipTspHaversineCosts,
	buildFlipTspRoadCosts,
	solveClusterTspWithFlipFromCosts
} from '$lib/routing/tsp';
import type { Phase, Point, Shape, Snapshot, Tool } from '$lib/types/sketch';
import { toolName } from '$lib/tools/names';
import { renderLayers } from '$lib/map/renderer';
import { canRoute, distanceLabel, routeInputPoints, type SketchStateLike } from './derived';
import { cloneShape, cloneShapes } from './cloning';
import { buildSnapshotEnvelope, parseSnapshotEnvelope } from './persistence';

const ROUTE_SETTINGS_STORAGE_KEY = 'gpx-art.routeSettings';

type L = typeof import('leaflet');

const MAX_UNDO = 40;
// Max distance (meters) from a click to the routedPath polyline for the
// click to count as a trim pick. 40 m is large enough to forgive typical
// mouse precision (~5 m) plus a road-width miss on either side of a thin
// street, but small enough that a stray click on empty canvas does not
// land a handle. Picked over a smaller value (e.g. 20 m) so users on
// touch devices or hi-DPI screens do not have to land exactly on the
// blue line.
const TRIM_PICK_MAX_DISTANCE_METERS = 40;

export interface MapHandle {
	L: L;
	map: Leaflet.Map;
	drawingLayer: Leaflet.LayerGroup;
	routeLayer: Leaflet.LayerGroup;
	// Optional debug layer for the OSRM batch overlay. Optional so test
	// harnesses that build a MapHandle by hand (e.g. Playwright) can
	// omit it — the renderer no-ops when the layer is undefined.
	debugLayer?: Leaflet.LayerGroup;
}

export class SketchState implements SketchStateLike {
	currentTool = $state<Tool>('pencil');
	phase = $state<Phase>('editing');
	shapes = $state<Shape[]>([]);
	draft = $state<Shape | null>(null);
	routedPath = $state<Point[] | null>(null);
	routeBusy = $state(false);
	undoStack = $state<Snapshot[]>([]);
	redoStack = $state<Snapshot[]>([]);
	includeRouteInExport = $state(false);
	// Span-trim sub-mode of phase: 'routed'. trimMode flips when the user
	// enters the trim flow; trimStart/trimEnd are indexes into routedPath
	// (so they refer to existing road-snapped vertices, not arbitrary
	// picked points). When trimStart === trimEnd the apply step is a no-op.
	trimMode = $state(false);
	trimStart = $state<number | null>(null);
	trimEnd = $state<number | null>(null);
	// Trim-specific instruction text. Distinct from status because
	// the status bar shows the general workspace status (sketch a
	// shape, route ready, ...) while the contextual TrimPanel reads
	// from this field for its hint line.
	trimHint = $state('');
	status = $state('Sketch a shape.');
	routeError = $state('');
	dragOrigin = $state<Point | null>(null);
	isDragging = $state(false);
	isSpacePan = $state(false);

	// OSRM batch debug overlay. routeDebugVisible is the user's preference
	// (persisted across undo via Snapshot.routeDebugVisible);
	// routeDebugBatches is the captured plan from the most recent
	// createRoute() call and is intentionally NOT snapshotted — it is a
	// transient view of the last route, recomputed on the next routing.
	routeDebugVisible = $state(false);
	routeDebugBatches = $state<RouteDebugBatch[]>([]);

	// Route fidelity + corner inset — session prefs, not undo history.
	// Persisted in localStorage; applied on the next createRoute() only.
	routeFidelity = $state<RouteFidelity>('balanced');
	cornerInsetMeters = $state(CORNER_INSET_DEFAULT_METERS);

	// Non-reactive scratch — see Preservation note #1. Plain refs that survive across
	// mousedown/mousemove/mouseup without triggering reactivity.
	activePencilShape: Shape | null = null;
	activeRectangleShape: Shape | null = null;
	previousTool: Tool | null = null;

	private _L: L | undefined;
	private _map: Leaflet.Map | undefined;
	private _drawingLayer: Leaflet.LayerGroup | undefined;
	private _routeLayer: Leaflet.LayerGroup | undefined;
	private _debugLayer: Leaflet.LayerGroup | undefined;

	canRoute = $derived(canRoute(this));
	hasDrawing = $derived(this.shapes.length > 0 || !!this.draft);
	distanceLabel = $derived(distanceLabel(this));
	pointLabel = $derived(`${routeInputPoints(this).length} sketch pts`);

	attachMap(handle: MapHandle) {
		this._L = handle.L;
		this._map = handle.map;
		this._drawingLayer = handle.drawingLayer;
		this._routeLayer = handle.routeLayer;
		this._debugLayer = handle.debugLayer;
		// Chevrons are placed in screen space against the current viewport.
		// Rebuild on zoom (density / projection) and on pan (which stretch
		// of a long close-up path is on screen). zoomend/moveend — not the
		// continuous zoom/move events — avoid thrashing mid-gesture.
		this._map.on('zoomend moveend', this._onMapViewChange);
	}

	detachMap() {
		this._map?.off('zoomend moveend', this._onMapViewChange);
		this._L = undefined;
		this._map = undefined;
		this._drawingLayer = undefined;
		this._routeLayer = undefined;
		this._debugLayer = undefined;
	}

	// Bound once so attach/detach can add/remove the same function ref.
	private _onMapViewChange = () => {
		// Only the route chrome depends on the viewport today; skip work
		// while sketching so pan/zoom stay light in the edit phase.
		if (!this.routedPath || this.routedPath.length < 2) return;
		this.render();
	};

	setTool(tool: Tool) {
		if (this.phase !== 'editing') return;
		if (tool === this.currentTool) return;
		this.applyTool(tool);
	}

	/** Resolve live OSRM knobs from the current UI prefs. */
	routingOptions(): RoutingOptions {
		return resolveRoutingOptions(this.routeFidelity, this.cornerInsetMeters);
	}

	setRouteFidelity(fidelity: RouteFidelity) {
		if (this.routeFidelity === fidelity) return;
		this.routeFidelity = fidelity;
		this.persistRouteSettings();
	}

	setCornerInsetMeters(meters: number) {
		const next = clampCornerInset(meters);
		if (this.cornerInsetMeters === next) return;
		this.cornerInsetMeters = next;
		this.persistRouteSettings();
	}

	/** Load route prefs from localStorage (call once on app start). */
	loadRouteSettings() {
		if (typeof localStorage === 'undefined') return;
		try {
			const raw = localStorage.getItem(ROUTE_SETTINGS_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as {
				fidelity?: unknown;
				cornerInsetMeters?: unknown;
			};
			if (isRouteFidelity(parsed.fidelity)) {
				this.routeFidelity = parsed.fidelity;
			}
			if (typeof parsed.cornerInsetMeters === 'number') {
				this.cornerInsetMeters = clampCornerInset(parsed.cornerInsetMeters);
			}
		} catch {
			// Ignore corrupt prefs — keep defaults.
		}
	}

	private persistRouteSettings() {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(
				ROUTE_SETTINGS_STORAGE_KEY,
				JSON.stringify({
					fidelity: this.routeFidelity,
					cornerInsetMeters: this.cornerInsetMeters
				})
			);
		} catch {
			// Quota / private mode — non-fatal.
		}
	}

	// Setter for the OSRM batch debug overlay toggle. Goes through a
	// method (not a direct field write) so the caller does not have to
	// remember to call render() — toggling the overlay must repaint the
	// map immediately to clear or restore the on-map markers.
	setRouteDebugVisible(visible: boolean) {
		if (this.routeDebugVisible === visible) return;
		this.routeDebugVisible = visible;
		this.render();
	}

	private applyTool(tool: Tool) {
		this.finishDraft();
		this.currentTool = tool;
		this.activePencilShape = null;
		this.activeRectangleShape = null;
		this.isDragging = false;
		this.status = tool === 'pan' ? 'Map navigation active.' : `${toolName(tool)} ready.`;
	}

	handleMapMouseDown(event: Leaflet.LeafletMouseEvent) {
		if (this.phase !== 'editing') return;

		if (this.currentTool === 'pencil') {
			event.originalEvent.preventDefault();
			this._map?.dragging.disable();
			this.isDragging = true;
			this.pushHistory();
			const firstPoint = toPoint(event.latlng);
			this.activePencilShape = {
				id: crypto.randomUUID(),
				points: [firstPoint],
				type: 'pencil'
			};
			this.shapes = [...this.shapes, this.activePencilShape];
			this.status = 'Drawing pencil stroke.';
			this.render();
		}

		if (this.currentTool === 'rectangle') {
			event.originalEvent.preventDefault();
			this._map?.dragging.disable();
			this.isDragging = true;
			this.pushHistory();
			const point = toPoint(event.latlng);
			this.dragOrigin = point;
			this.activeRectangleShape = {
				id: crypto.randomUUID(),
				points: rectanglePoints(point, point),
				type: 'rectangle'
			};
			this.shapes = [...this.shapes, this.activeRectangleShape];
			this.status = 'Sizing rectangle.';
			this.render();
		}

		if (this.currentTool === 'line' || this.currentTool === 'polygon') {
			// Without this, the map's default drag handler steals the gesture and
			// pans the map on every click — and trying to drag a vertex marker
			// (which lives inside the drawing layer) has the same effect. Match
			// the pencil/rectangle behaviour: prevent default + disable map drag,
			// then let handleMapClick add the new vertex on mouseup.
			event.originalEvent.preventDefault();
			this._map?.dragging.disable();
		}
	}

	handleMapMouseMove(event: Leaflet.LeafletMouseEvent) {
		if (this.phase !== 'editing') return;

		if (this.activePencilShape && this.currentTool === 'pencil') {
			const nextPoint = toPoint(event.latlng);
			const previous = this.activePencilShape.points.at(-1);
			if (!previous || distanceBetween(previous, nextPoint) > 8) {
				this.activePencilShape.points = [...this.activePencilShape.points, nextPoint];
				const activeId = this.activePencilShape.id;
				this.shapes = this.shapes.map((shape) =>
					shape.id === activeId ? (this.activePencilShape as Shape) : shape
				);
				this.render();
			}
		}

		if (this.activeRectangleShape && this.dragOrigin && this.currentTool === 'rectangle') {
			const origin = this.dragOrigin;
			const newPoints = rectanglePoints(origin, toPoint(event.latlng));
			this.activeRectangleShape.points = newPoints;
			const activeId = this.activeRectangleShape.id;
			this.shapes = this.shapes.map((shape) =>
				shape.id === activeId ? (this.activeRectangleShape as Shape) : shape
			);
			this.render();
		}
	}

	handleMapMouseUp() {
		if (this.phase !== 'editing') return;

		if (this.activePencilShape) {
			if (this.activePencilShape.points.length < 2) {
				const activeId = this.activePencilShape.id;
				this.shapes = this.shapes.filter((shape) => shape.id !== activeId);
			}
			this.activePencilShape = null;
			this.status = 'Pencil line finished.';
		}

		if (this.activeRectangleShape) {
			if (
				this.dragOrigin &&
				distanceBetween(
					this.activeRectangleShape.points[0],
					this.activeRectangleShape.points.at(-1)!
				) < 12
			) {
				const activeId = this.activeRectangleShape.id;
				this.shapes = this.shapes.filter((shape) => shape.id !== activeId);
			}
			this.activeRectangleShape = null;
			this.dragOrigin = null;
			this.status = 'Rectangle added.';
		}

		this._map?.dragging.enable();
		this.isDragging = false;
		this.render();
	}

	handleMapClick(event: Leaflet.LeafletMouseEvent) {
		if (this.phase === 'routed' && this.trimMode) {
			this.handleTrimClick(event);
			return;
		}
		if (this.phase !== 'editing' || (this.currentTool !== 'line' && this.currentTool !== 'polygon'))
			return;
		this.pushHistory();

		if (!this.draft || this.draft.type !== this.currentTool) {
			this.finishDraft();
			this.draft = {
				id: crypto.randomUUID(),
				points: [toPoint(event.latlng)],
				type: this.currentTool
			};
		} else {
			this.draft = {
				...this.draft,
				points: [...this.draft.points, toPoint(event.latlng)]
			};
		}

		this.status = `${toolName(this.currentTool)} point added.`;
		this.render();
	}

	// Project a map click onto the routedPath polyline and assign it to
	// either trimStart or trimEnd. Trim is a two-pick flow: the first
	// click sets the start of the span, the second sets the end. A third
	// click restarts the flow with the new click as the start. A click on
	// the same vertex as the previous pick resets both picks so the user
	// can correct a misclick without leaving trim mode.
	private handleTrimClick(event: Leaflet.LeafletMouseEvent) {
		if (!this.routedPath || this.routedPath.length < 2) {
			this.status = 'Nothing to trim.';
			this.trimHint = '';
			return;
		}
		const click = toPoint(event.latlng);
		const { index, distance } = nearestRouteVertexIndex(this.routedPath, click);
		if (distance > TRIM_PICK_MAX_DISTANCE_METERS) {
			this.trimHint = `Pick closer to the route — the click was ${Math.round(distance)} m off.`;
			this.status = 'Pick closer to the route.';
			return;
		}
		if (this.trimStart === null) {
			this.trimStart = index;
			this.trimHint = 'Now mark the end of the stretch to remove.';
			this.status = 'Route ready — trim, export, or edit.';
		} else if (this.trimEnd === null) {
			if (index === this.trimStart) {
				this.trimStart = null;
				this.trimEnd = null;
				this.trimHint = 'Click the start of the stretch you want to remove.';
				this.status = 'Route ready — trim, export, or edit.';
				this.render();
				return;
			}
			this.trimEnd = index;
			this.trimHint = 'Confirm to drop the marked span, or cancel to start over.';
			this.status = 'Route ready — trim, export, or edit.';
		} else {
			// Both picks already set — treat the next click as a fresh
			// start. The hint flips back to "mark the end" so the
			// two-step flow stays obvious.
			this.trimStart = index;
			this.trimEnd = null;
			this.trimHint = 'Now mark the end of the stretch to remove.';
			this.status = 'Route ready — trim, export, or edit.';
		}
		this.render();
	}

	finishDraft() {
		if (!this.draft) return;

		const requiredPoints = this.draft.type === 'polygon' ? 3 : 2;
		if (this.draft.points.length >= requiredPoints) {
			this.pushHistory();
			this.shapes = [...this.shapes, this.draft];
			this.status = `${toolName(this.draft.type)} finished.`;
		} else {
			this.status = `${toolName(this.draft.type)} needs ${requiredPoints} points.`;
		}

		this.draft = null;
		this.render();
	}

	undo() {
		const previous = this.undoStack.at(-1);
		if (!previous || this.phase === 'routing') return;

		this.pushCurrentToRedo();
		this.undoStack = this.undoStack.slice(0, -1);
		this.shapes = cloneShapes(previous.shapes);
		this.draft = previous.draft ? cloneShape(previous.draft) : null;
		this.routedPath = previous.routedPath;
		this.phase = previous.phase;
		this.trimMode = previous.trimMode ?? false;
		this.trimStart = previous.trimStart ?? null;
		this.trimEnd = previous.trimEnd ?? null;
		this.trimHint = previous.trimHint ?? '';
		this.routeDebugVisible = previous.routeDebugVisible ?? false;
		// routeDebugBatches is a transient view of the last route, not
		// part of the document — wipe it on undo so a stale overlay does
		// not survive a shape-edit undo. The user can click Route again
		// to recompute.
		this.routeDebugBatches = [];
		this.activePencilShape = null;
		this.activeRectangleShape = null;
		this.dragOrigin = null;
		this.isDragging = false;
		this.routeBusy = false;
		this.status = 'Undid recent action.';
		this.render();
	}

	redo() {
		const next = this.redoStack.at(-1);
		if (!next || this.phase === 'routing') return;

		this.pushCurrentToUndo();
		this.redoStack = this.redoStack.slice(0, -1);
		this.shapes = cloneShapes(next.shapes);
		this.draft = next.draft ? cloneShape(next.draft) : null;
		this.routedPath = next.routedPath;
		this.phase = next.phase;
		this.trimMode = next.trimMode ?? false;
		this.trimStart = next.trimStart ?? null;
		this.trimEnd = next.trimEnd ?? null;
		this.trimHint = next.trimHint ?? '';
		this.routeDebugVisible = next.routeDebugVisible ?? false;
		this.routeDebugBatches = [];
		this.activePencilShape = null;
		this.activeRectangleShape = null;
		this.dragOrigin = null;
		this.isDragging = false;
		this.routeBusy = false;
		this.status = 'Redid recent action.';
		this.render();
	}

	private pushCurrentToUndo() {
		this.undoStack = [...this.undoStack.slice(-(MAX_UNDO - 1)), this.snapshot()];
	}

	private pushCurrentToRedo() {
		const current = this.snapshot();
		this.redoStack = [...this.redoStack.slice(-(MAX_UNDO - 1)), current];
	}

	clearDrawing(options: { skipHistory?: boolean } = {}) {
		if (!options.skipHistory && !this.hasDrawing) return;
		if (!options.skipHistory) this.pushHistory();
		this.shapes = [];
		this.draft = null;
		this.routedPath = null;
		this.routeError = '';
		this.phase = 'editing';
		this.routeBusy = false;
		this.isDragging = false;
		this.trimMode = false;
		this.trimStart = null;
		this.trimEnd = null;
		this.trimHint = '';
		this.routeDebugBatches = [];
		this.status = 'Canvas cleared.';
		this.render();
	}

	handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			this.finishDraft();
		}

		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) {
				this.redo();
			} else {
				this.undo();
			}
		}

		if (event.code === 'Space' && !event.repeat) {
			if (this.phase !== 'editing' || this.isSpacePan) return;
			event.preventDefault();
			this.previousTool = this.currentTool;
			this.applyTool('pan');
			this.isSpacePan = true;
		}
	}

	handleKeyup(event: KeyboardEvent) {
		if (event.code !== 'Space' || !this.isSpacePan) return;
		event.preventDefault();
		const restore = this.previousTool ?? this.currentTool;
		this.previousTool = null;
		this.isSpacePan = false;
		if (this.phase === 'editing' && restore !== this.currentTool) {
			this.applyTool(restore);
		}
	}

	async createRoute() {
		// Auto-commit any in-progress draft so Route works in one click.
		// Finish remains available for commit-without-routing (Esc / button).
		if (this.draft) {
			this.finishDraft();
		}

		const shapes = this.shapes.filter((shape) => shape.points.length >= 2);
		if (shapes.length === 0) {
			this.routeError = 'Add at least one shape with 2+ points before routing.';
			return;
		}

		this.snapshot();
		this.routeError = '';
		this.phase = 'routing';
		this.routeBusy = true;
		this.status = 'Solving route…';
		this.render();

		try {
			const last = shapes.map((s) => s.points[s.points.length - 1]);
			const first = shapes.map((s) => s.points[0]);
			const closed = shapes.map((s) => isClosedShapeType(s.type));

			// Optimised order + direction. Prefer OSRM /table road costs when
			// N is small; fall back to haversine. Closed shapes use entry=exit
			// (full loop, leave from start). See $lib/routing/tsp.
			this.status = 'Optimizing order between shapes…';
			const roadCosts = await buildFlipTspRoadCosts(first, last, closed);
			const costs = roadCosts ?? buildFlipTspHaversineCosts(first, last, closed);
			const { order, directions } = solveClusterTspWithFlipFromCosts(shapes.length, costs);

			this.status = 'Routing along your shapes…';
			const routeOpts = this.routingOptions();
			const prepared = order.map((shapeIdx, visitIdx) =>
				prepareShapeRoute(shapes[shapeIdx], directions[visitIdx], visitIdx, routeOpts)
			);

			// Parallel OSRM: all shapes (single /route or per-edge /route)
			// + inter-shape links, then stitch in visit order.
			type ShapeOsrmResult = { kind: 'empty' } | { kind: 'route'; geometries: string[] };

			const [shapeResults, linkResults] = await Promise.all([
				Promise.all(
					prepared.map(async (p): Promise<ShapeOsrmResult> => {
						if (p.points.length < 2) return { kind: 'empty' };
						// Pencil and structured: one or more hard-via /route calls.
						const routed = await routePreparedStructured(p, routeOpts);
						return { kind: 'route', geometries: routed.geometries };
					})
				),
				prepared.length < 2
					? Promise.resolve([] as RouteResult[])
					: Promise.all(
							// Two-point links: no intermediate vias, continue_straight irrelevant.
							prepared.slice(0, -1).map((p, i) => getRoute([p.exit, prepared[i + 1].entry]))
						)
			]);

			const polylines: Point[] = [];
			const processedPoints: Point[][] = prepared.map((p) => p.points);

			for (let i = 0; i < prepared.length; i++) {
				const result = shapeResults[i];
				if (result.kind === 'route') {
					for (const geometry of result.geometries) {
						await appendGeometryToPath(polylines, geometry);
					}
				}

				if (i < linkResults.length) {
					await appendGeometryToPath(polylines, linkResults[i].geometry);
				}
			}

			// Single cleanup pass with a hard /route budget. Pass sketch
			// corners so wasteful approach loops near geometric vertices
			// (e.g. Powązkowska) can be collapsed.
			const sketchCorners = shapes.flatMap((s) => s.points);
			this.routedPath = await cleanRoutedPathOnNetwork(polylines, undefined, {
				corners: sketchCorners
			});

			// Debug plan: points actually sent to OSRM for each shape.
			const orderedShapes = prepared.map((p) => p.shape);
			this.routeDebugBatches = buildRoutePlan(orderedShapes, processedPoints);

			this.phase = 'routed';
			this.routeBusy = false;
			this.status = 'Route ready — export or edit.';
			this.render();
		} catch (err) {
			// Revert on any failure. v1 is strict — one bad shape aborts the
			// whole thing; we can add lenient partial-result handling later.
			this.routeError = err instanceof Error ? err.message : String(err);
			this.phase = 'editing';
			this.routeBusy = false;
			this.status = 'Routing failed — try editing and rerouting.';
			this.render();
		}
	}

	backToEditing() {
		this.snapshot();
		this.routedPath = null;
		this.routeError = '';
		this.routeBusy = false;
		this.phase = 'editing';
		// Trim sub-mode only exists inside phase: 'routed'. Wiping the
		// route also wipes the trim state so the next time we re-route we
		// start fresh — the user could otherwise be left in trimMode with
		// no route to trim.
		this.trimMode = false;
		this.trimStart = null;
		this.trimEnd = null;
		this.trimHint = '';
		// The OSRM batch overlay describes the route we just left — drop
		// it alongside routedPath so the user is not left staring at
		// colored markers over an emptied canvas.
		this.routeDebugBatches = [];
		this.status = 'Sketch a shape.';
		this.render();
	}

	startTrim() {
		if (this.phase !== 'routed') return;
		if (!this.routedPath || this.routedPath.length < 2) {
			this.status = 'Nothing to trim — the route is empty.';
			return;
		}
		// Entering trim mode is a UI state flip, not a data mutation: no
		// history entry. The actual mutation happens in applyTrim().
		this.trimMode = true;
		this.trimStart = null;
		this.trimEnd = null;
		// Keep status generic — the trim-specific hint lives in
		// trimHint and is read by the TrimPanel above the action bar.
		this.status = 'Route ready — trim, export, or edit.';
		this.trimHint = 'Click the start of the stretch you want to remove.';
		this.render();
	}

	cancelTrim() {
		if (!this.trimMode) return;
		this.trimMode = false;
		this.trimStart = null;
		this.trimEnd = null;
		this.status = 'Trim cancelled.';
		this.trimHint = '';
		this.render();
	}

	async applyTrim() {
		if (this.phase !== 'routed') return;
		if (!this.routedPath || this.routedPath.length === 0) {
			this.cancelTrim();
			return;
		}
		const start = this.trimStart;
		const end = this.trimEnd;
		if (start === null || end === null) {
			this.status = 'Trim: pick both ends before confirming.';
			return;
		}
		// Snap to integer indexes. The pick path rounds via Math.round in
		// handleMapClick, but be defensive in case a drag leaves a
		// non-integer — trim only operates on routedPath entries.
		const lo = Math.max(0, Math.min(start, end));
		const hi = Math.min(this.routedPath.length - 1, Math.max(start, end));
		// Same point picked twice is a degenerate span (1 point). Treat
		// it as "clear the picks, please pick a wider span" rather than
		// mutating the route. Adjacent handles (hi - lo === 1) are valid
		// — that's a real two-point stretch.
		if (lo === hi) {
			this.trimStart = null;
			this.trimEnd = null;
			this.status = 'Route ready — trim, export, or edit.';
			this.trimHint = 'Pick two different points to mark a span.';
			this.render();
			return;
		}
		// Removing an entire route would leave phase: 'routed' with an
		// empty polyline, which the renderer skips silently — the user
		// would see no GPX and no useful UI. Refuse at one-point-remaining.
		if (hi - lo + 1 >= this.routedPath.length) {
			this.trimHint = 'That would remove the whole route — pick a smaller span.';
			this.status = 'Route ready — trim, export, or edit.';
			return;
		}

		this.pushHistory();

		// Endpoints immediately outside the cut span. After the splice,
		// the route has to traverse from `before` to `after` (when both
		// exist); without a bridge, Leaflet would draw a straight-line
		// jump cut that OSRM's /route can replace with real streets.
		const before = lo > 0 ? this.routedPath[lo - 1] : null;
		const after = hi < this.routedPath.length - 1 ? this.routedPath[hi + 1] : null;

		// Drop the cut handles immediately — they reference indexes that
		// no longer exist after the splice. routeBusy gates the action
		// bar's Route button (already absent in this phase, but kept
		// consistent with createRoute's loading flag).
		this.trimMode = false;
		this.trimStart = null;
		this.trimEnd = null;
		this.trimHint = '';

		if (!before || !after) {
			// Cut at the start or end of the route — no bridge needed,
			// the surviving half is the entire route.
			this.routedPath = [...this.routedPath.slice(0, lo), ...this.routedPath.slice(hi + 1)];
			this.status = `Removed ${hi - lo + 1} points from the route.`;
			this.render();
			return;
		}

		// Capture the pre-bridge phase so we can ignore a late OSRM
		// response if the user clicked Edit (or anything else that
		// drops routedPath) while we were awaiting.
		const phaseBefore = this.phase;
		const beforeHalf = this.routedPath.slice(0, lo);
		const afterHalf = this.routedPath.slice(hi + 1);

		// Optimistic splice: render the straight-line cut instantly so
		// the user sees their action take effect. The bridge call below
		// replaces the straight link with road-snapped geometry when
		// it returns.
		this.routedPath = [...beforeHalf, ...afterHalf];
		this.routeBusy = true;
		this.status = 'Routing the link…';
		this.render();

		try {
			const { geometry } = await getRoute([before, after]);
			// The user might have left routed phase while we were
			// awaiting. Drop the bridge on the floor in that case so we
			// don't resurrect a route after Edit.
			if (this.phase !== phaseBefore || this.phase !== 'routed') return;
			const decoded = decodePolyline(geometry);
			// OSRM's /route starts at the first waypoint, so the first
			// decoded coordinate often equals `before` within rounding.
			// Skip it to avoid doubling up at the join.
			const bridge =
				decoded.length > 0 && distanceBetween(decoded[0], before) <= 2 ? decoded.slice(1) : decoded;
			if (bridge.length === 0) {
				// OSRM returned nothing usable. Keep the straight-line
				// splice; surface the failure in routeError.
				this.routeError = 'OSRM returned no route for the link — kept a straight line.';
				this.routeBusy = false;
				this.status = `Removed ${hi - lo + 1} points; bridge unavailable.`;
			} else {
				this.routedPath = [...beforeHalf, ...bridge, ...afterHalf];
				this.routeBusy = false;
				this.status = `Removed ${hi - lo + 1} points; routed a ${bridge.length}-point link.`;
			}
			this.render();
		} catch (err) {
			if (this.phase !== phaseBefore || this.phase !== 'routed') return;
			// Bridge failure: fall back to the straight-line splice so
			// the cut is at least visually obvious. The user can undo
			// and retry, or click Edit to start over.
			this.routeError = err instanceof Error ? err.message : String(err);
			this.routeBusy = false;
			this.status = `Removed ${hi - lo + 1} points; bridge failed — kept a straight line.`;
			this.render();
		}
	}

	moveTrimHandle(which: 'start' | 'end', index: number) {
		if (!this.trimMode || !this.routedPath) return;
		const clamped = Math.max(0, Math.min(this.routedPath.length - 1, Math.round(index)));
		if (which === 'start') {
			this.trimStart = clamped;
		} else {
			this.trimEnd = clamped;
		}
		this.render();
	}

	downloadGpx() {
		if (!this.routedPath || this.routedPath.length === 0) return;

		const gpx = pointsToGpx(this.routedPath, 'gpx-art route');
		const blob = new Blob([gpx], { type: 'application/gpx+xml' });
		const url = URL.createObjectURL(blob);

		const today = new SvelteDate().toISOString().slice(0, 10);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `gpx-art-route-${today}.gpx`;
		document.body.appendChild(anchor);
		anchor.click();
		document.body.removeChild(anchor);
		URL.revokeObjectURL(url);

		this.status = 'GPX downloaded.';
	}

	exportDrawing() {
		if (!this.hasDrawing && (!this.routedPath || this.routedPath.length === 0)) {
			this.status = 'Nothing to export.';
			return;
		}

		// When the user checks "Include route" we attach the matched path and
		// set phase='routed'. If there is no usable routedPath, fall back silently
		// to a shapes-only export rather than warning.
		const includeRoute =
			!!this.routedPath && this.routedPath.length >= 2 && this.includeRouteInExport;
		const snapshot: Snapshot = {
			shapes: cloneShapes(this.shapes),
			draft: this.draft ? cloneShape(this.draft) : null,
			phase: includeRoute ? 'routed' : 'editing',
			routedPath: includeRoute && this.routedPath ? [...this.routedPath] : null
		};

		const json = JSON.stringify(buildSnapshotEnvelope(snapshot), null, '\t');
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);

		const today = new SvelteDate().toISOString().slice(0, 10);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `gpx-art-drawing-${today}.json`;
		document.body.appendChild(anchor);
		anchor.click();
		document.body.removeChild(anchor);
		URL.revokeObjectURL(url);

		this.status = includeRoute ? 'Drawing + route exported.' : 'Drawing exported.';
	}

	async importDrawing(source: File | string) {
		if (this.phase === 'routing') {
			this.status = 'Wait for routing to finish, then import.';
			return;
		}

		let raw: string;
		try {
			raw = typeof source === 'string' ? source : await source.text();
		} catch {
			this.status = "Couldn't read the file.";
			return;
		}
		if (raw.trim() === '') {
			this.status = 'File is empty — nothing to import.';
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			this.status = "File isn't valid JSON.";
			return;
		}

		const result = parseSnapshotEnvelope(parsed);
		if (!result.ok) {
			this.status = `Can't import: ${result.reason}`;
			return;
		}

		// Capture the pre-import state on the undo stack so a bad import is
		// recoverable with Cmd/Ctrl+Z. clearDrawing() then wipes the canvas
		// without pushing again — one undo entry, not two.
		this.pushHistory();
		this.clearDrawing({ skipHistory: true });

		const snap = result.snapshot;
		this.shapes = cloneShapes(snap.shapes);
		this.draft = snap.draft ? cloneShape(snap.draft) : null;
		this.routedPath = snap.routedPath ? [...snap.routedPath] : null;

		// The only intentional phase override: a saved routed file with no/too
		// few routedPath points would leave the UI in a broken 'routed' state
		// with nothing to render. Snap back to editing with a status note.
		if (snap.phase === 'routed' && (!this.routedPath || this.routedPath.length < 2)) {
			this.phase = 'editing';
			this.status = 'Imported sketch (routed path was incomplete — reset to editing).';
		} else {
			this.phase = snap.phase;
			this.status = snap.phase === 'routed' ? 'Imported sketch with route.' : 'Imported sketch.';
		}

		this.trimMode = snap.trimMode ?? false;
		this.trimStart = snap.trimStart ?? null;
		this.trimEnd = snap.trimEnd ?? null;
		this.trimHint = snap.trimHint ?? '';
		this.routeDebugVisible = snap.routeDebugVisible ?? false;
		// Clear the overlay — the import may have changed the shape set
		// drastically, and the old batches no longer describe the
		// imported state. Recompute on the next Route click.
		this.routeDebugBatches = [];
		this.activePencilShape = null;
		this.activeRectangleShape = null;
		this.dragOrigin = null;
		this.isDragging = false;
		this.routeBusy = false;
		this.render();
	}

	updateShapeVertex(shapeId: string, pointIndex: number, point: Point, isDraft: boolean) {
		if (isDraft) {
			if (!this.draft || this.draft.id !== shapeId) return;
			if (pointIndex < 0 || pointIndex >= this.draft.points.length) return;
			const next = [...this.draft.points];
			next[pointIndex] = point;
			this.draft = { ...this.draft, points: next };
		} else {
			this.shapes = this.shapes.map((shape) => {
				if (shape.id !== shapeId) return shape;
				if (pointIndex < 0 || pointIndex >= shape.points.length) return shape;
				// Rectangles must stay axis-aligned: the opposite corner stays
				// put and the two adjacent corners are repositioned by
				// `resizeRectangle`. Other shapes get a plain index replace.
				const next =
					shape.type === 'rectangle'
						? resizeRectangle(shape.points, pointIndex, point)
						: shape.points.map((p, i) => (i === pointIndex ? point : p));
				return { ...shape, points: next };
			});
		}
		this.render();
	}

	private render() {
		renderLayers(
			this._L,
			this._map,
			this._drawingLayer,
			this.shapes,
			this.draft,
			(shapeId, pointIndex, point, isDraft) =>
				this.updateShapeVertex(shapeId, pointIndex, point, isDraft),
			// Line, polygon, and rectangle shapes expose draggable vertex
			// handles after commit. Pencil is excluded — it's a freeform
			// stroke with many points, so per-vertex editing would be
			// tedious. Trade-off: while a drawing tool is active, mousing
			// down on an existing vertex drags that vertex instead of
			// beginning a new shape — start new shapes in empty space.
			(shape) => shape.type !== 'pencil',
			this._routeLayer,
			this.routedPath,
			this.trimMode,
			this.trimStart,
			this.trimEnd,
			(which, point) => this.dropTrimHandle(which, point),
			// OSRM batch debug overlay: render only when the toggle is on.
			// The layer itself is always created (in bootstrap) so toggling
			// is a state change, not a map mutation.
			this._debugLayer,
			this.routeDebugVisible ? this.routeDebugBatches : []
		);
	}

	// Project a dropped trim handle onto the nearest routedPath vertex and
	// move the handle there. Called once per mouseup on the handle's drag
	// gesture. The visual marker has already moved freely during the drag;
	// this is the single state-commit step that locks in the new index.
	private dropTrimHandle(which: 'start' | 'end', point: Point) {
		if (!this.trimMode || !this.routedPath || this.routedPath.length === 0) return;
		const { index } = nearestRouteVertexIndex(this.routedPath, point);
		this.moveTrimHandle(which, index);
	}

	private pushHistory() {
		this.pushCurrentToUndo();
		this.redoStack = [];
	}

	private snapshot(): Snapshot {
		return {
			draft: this.draft ? cloneShape(this.draft) : null,
			phase: this.phase,
			routedPath: this.routedPath ? [...this.routedPath] : null,
			shapes: cloneShapes(this.shapes),
			trimMode: this.trimMode,
			trimStart: this.trimStart,
			trimEnd: this.trimEnd,
			trimHint: this.trimHint,
			routeDebugVisible: this.routeDebugVisible
		};
	}
}

async function appendGeometryToPath(path: Point[], geometry: string) {
	// Decode only here. Network cleanup runs once on the full stitched path
	// (see createRoute) with a hard bridge budget — cleaning every chunk
	// caused request storms when false-positive "loops" re-routed forever.
	const points = decodePolyline(geometry);
	if (points.length === 0) return;

	const previous = path.at(-1);
	if (previous) {
		const next = points[0];
		if (!sameRoutePoint(previous, next)) {
			const { geometry: bridge } = await getRoute([previous, next]);
			appendDecodedPoints(path, decodePolyline(bridge));
		}
	}

	appendDecodedPoints(path, points);
}

function appendDecodedPoints(path: Point[], points: Point[]) {
	if (points.length === 0) return;
	if (path.length > 0 && sameRoutePoint(path[path.length - 1], points[0])) {
		path.push(...points.slice(1));
		return;
	}
	path.push(...points);
}

function sameRoutePoint(a: Point, b: Point) {
	return distanceBetween(a, b) <= 2;
}

// Snap a click to the nearest vertex of a polyline. Used by the trim
// flow to convert a (lat, lng) click into an index into routedPath.
// Vertex-distance rather than perpendicular distance to a segment is
// intentional: trim handles are placed on existing routedPath entries
// (so the cut can be re-routed without dropping the snapped endpoint),
// and snapping to the nearest vertex produces predictable handle
// positions for the user. Distance is reported back so the caller can
// gate against a max-distance threshold.
function nearestRouteVertexIndex(path: Point[], target: Point) {
	let bestIndex = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let i = 0; i < path.length; i++) {
		const d = distanceBetween(path[i], target);
		if (d < bestDistance) {
			bestDistance = d;
			bestIndex = i;
		}
	}
	return { index: bestIndex, distance: bestDistance };
}
