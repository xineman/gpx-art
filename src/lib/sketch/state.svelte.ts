import { SvelteDate } from 'svelte/reactivity';
import type * as Leaflet from 'leaflet';
import { distanceBetween } from '$lib/geometry/distance';
import { rectanglePoints, resizeRectangle, toPoint } from '$lib/geometry/point';
import { RDP_TOLERANCE, RDP_TOLERANCE_PENCIL } from '$lib/constants/routing';
import { pointsToGpx } from '$lib/routing/gpx';
import { getMatchedRoute, getRoute } from '$lib/routing/osrm';
import { decodePolyline } from '$lib/routing/polyline';
import { simplifyRdp } from '$lib/routing/rdp';
import { sampleTrace } from '$lib/routing/sample';
import { solveClusterTspWithFlip } from '$lib/routing/tsp';
import type { Phase, Point, Shape, Snapshot, Tool } from '$lib/types/sketch';
import { toolName } from '$lib/tools/names';
import { renderLayers } from '$lib/map/renderer';
import { canRoute, distanceLabel, routeInputPoints, type SketchStateLike } from './derived';
import { cloneShape, cloneShapes } from './cloning';
import { buildSnapshotEnvelope, parseSnapshotEnvelope } from './persistence';

type L = typeof import('leaflet');

const MAX_UNDO = 40;

export interface MapHandle {
	L: L;
	map: Leaflet.Map;
	drawingLayer: Leaflet.LayerGroup;
	routeLayer: Leaflet.LayerGroup;
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
	status = $state('Sketch a shape.');
	routeError = $state('');
	dragOrigin = $state<Point | null>(null);
	isDragging = $state(false);
	isSpacePan = $state(false);

	// Non-reactive scratch — see Preservation note #1. Plain refs that survive across
	// mousedown/mousemove/mouseup without triggering reactivity.
	activePencilShape: Shape | null = null;
	activeRectangleShape: Shape | null = null;
	previousTool: Tool | null = null;

	private _L: L | undefined;
	private _map: Leaflet.Map | undefined;
	private _drawingLayer: Leaflet.LayerGroup | undefined;
	private _routeLayer: Leaflet.LayerGroup | undefined;

	canRoute = $derived(canRoute(this));
	hasDrawing = $derived(this.shapes.length > 0 || !!this.draft);
	distanceLabel = $derived(distanceLabel(this));
	pointLabel = $derived(`${routeInputPoints(this).length} sketch pts`);

	attachMap(handle: MapHandle) {
		this._L = handle.L;
		this._map = handle.map;
		this._drawingLayer = handle.drawingLayer;
		this._routeLayer = handle.routeLayer;
	}

	detachMap() {
		this._L = undefined;
		this._map = undefined;
		this._drawingLayer = undefined;
		this._routeLayer = undefined;
	}

	setTool(tool: Tool) {
		if (this.phase !== 'editing') return;
		if (tool === this.currentTool) return;
		this.applyTool(tool);
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
		// We route over committed shapes only — the user is expected to Finish
		// any draft before clicking Route (the Route button is still enabled
		// when only a draft exists, so we error gracefully in that case).
		const shapes = this.shapes.filter((shape) => shape.points.length >= 2);
		if (shapes.length === 0) {
			this.routeError = 'Finish your draft, then add at least one shape with 2+ points.';
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

			// Optimised order + direction for each shape. The solver picks
			// the visit order, but also which endpoint is the entry and which
			// is the exit — tracing a shape in reverse is allowed when it
			// minimises the inter-shape travel distance. See
			// solveClusterTspWithFlip in $lib/routing/tsp for the full
			// algorithm explanation.
			this.status = 'Optimizing order between shapes…';
			const { order, directions } = solveClusterTspWithFlip(first, last);

			this.status = 'Routing along your shapes…';
			const polylines: Point[] = [];
			for (let i = 0; i < order.length; i++) {
				const shape = shapes[order[i]];
				const isClosed = shape.type === 'polygon' || shape.type === 'rectangle';
				const isReversed = directions[i];

				// Reverse the vertex list when the solver chose to trace this
				// shape backwards. shape.points is always stored as an open
				// chain in drawn order; reversing it produces an open chain
				// in reverse-drawn order. RDP simplification is
				// direction-agnostic (chord distances are the same), so either
				// input gives equally valid simplified anchors.
				const sourcePoints = isReversed ? [...shape.points].reverse() : shape.points;

				// Sample the original drawing into a GPS-like trace for OSRM.
				// Interior points are soft guidance instead of hard via stops,
				// which lets the route stay on nearby streets instead of
				// detouring through exact sketch vertices.
				let pts = sampleTrace(isClosed ? [...sourcePoints, sourcePoints[0]] : sourcePoints);

				// RDP-simplify the sampled trace. Pencil strokes use the higher
				// tolerance (RDP_TOLERANCE_PENCIL) because their curves
				// have many fine-grained points whose perpendicular
				// distance sits just above RDP_TOLERANCE; without the
				// higher value, /match sees the full noisy trace and
				// runs slow. Structured shapes use the default tolerance
				// — they're effectively a no-op for them anyway since
				// their input has only a handful of vertices. Strip the
				// closing point before simplifying so the chord back to
				// start isn't degenerate (would swallow every interior
				// point).
				const rdpTolerance = shape.type === 'pencil' ? RDP_TOLERANCE_PENCIL : RDP_TOLERANCE;
				const rdpped = simplifyRdp(isClosed ? pts.slice(0, -1) : pts, rdpTolerance);
				pts = isClosed && rdpped.length > 0 ? [...rdpped, rdpped[0]] : rdpped;

				// Degenerate fallback: if simplification produced too little
				// to work with, route the raw shape instead so we still
				// produce something.
				if (pts.length < 2) {
					pts = isClosed ? [...sourcePoints, sourcePoints[0]] : sourcePoints;
				}

				if (shape.type === 'pencil') {
					// /match handles the noise and outliers that pencil
					// strokes accumulate. The HMM can drop tracepoints that
					// don't snap, which is the reason /match exists.
					const { geometries } = await getMatchedRoute(pts);
					for (const geometry of geometries) {
						await appendGeometryToPath(polylines, geometry);
					}
				} else {
					// Structured shapes (rectangle / line / polygon) have
					// user-clicked corners with no outliers to drop. /route
					// via the RDP'd anchors is exact and ~20× faster than
					// /match for these — the public demo's `TooBig`
					// radius rejection goes away too.
					const { geometry } = await getRoute(pts);
					await appendGeometryToPath(polylines, geometry);
				}

				if (i < order.length - 1) {
					// Transitions are always 2 points — no simplification needed.
					// The exit of the current shape and the entry of the next
					// depend on their chosen directions: forward means
					// entry=first, exit=last; reverse swaps them.
					const currentShape = shape;
					const nextShape = shapes[order[i + 1]];
					const currentExit = isReversed
						? currentShape.points[0]
						: currentShape.points[currentShape.points.length - 1];
					const nextEntry = directions[i + 1]
						? nextShape.points[nextShape.points.length - 1]
						: nextShape.points[0];
					const { geometry: link } = await getRoute([currentExit, nextEntry]);
					await appendGeometryToPath(polylines, link);
				}
			}

			this.routedPath = polylines;
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
		this.status = 'Sketch a shape.';
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
			this.routedPath
		);
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
			shapes: cloneShapes(this.shapes)
		};
	}
}

async function appendGeometryToPath(path: Point[], geometry: string) {
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
