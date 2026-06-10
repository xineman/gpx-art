import type * as Leaflet from 'leaflet';
import { distanceBetween } from '$lib/geometry/distance';
import { rectanglePoints, toPoint } from '$lib/geometry/point';
import type { Phase, Point, Shape, Snapshot, Tool } from '$lib/types/sketch';
import { toolName } from '$lib/tools/names';
import { renderLayers } from '$lib/map/renderer';
import { canRoute, distanceLabel, routeInputPoints, type SketchStateLike } from './derived';
import { cloneShape, cloneShapes } from './cloning';

type L = typeof import('leaflet');

const MAX_UNDO = 40;

export interface MapHandle {
	L: L;
	map: Leaflet.Map;
	drawingLayer: Leaflet.LayerGroup;
}

export class SketchState implements SketchStateLike {
	currentTool = $state<Tool>('pencil');
	phase = $state<Phase>('editing');
	shapes = $state<Shape[]>([]);
	draft = $state<Shape | null>(null);
	undoStack = $state<Snapshot[]>([]);
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

	canRoute = $derived(canRoute(this));
	hasDrawing = $derived(this.shapes.length > 0 || !!this.draft);
	distanceLabel = $derived(distanceLabel(this));
	pointLabel = $derived(`${routeInputPoints(this).length} sketch pts`);

	attachMap(handle: MapHandle) {
		this._L = handle.L;
		this._map = handle.map;
		this._drawingLayer = handle.drawingLayer;
	}

	detachMap() {
		this._L = undefined;
		this._map = undefined;
		this._drawingLayer = undefined;
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
			this.status = 'Pencil stroke added.';
		}

		if (this.activeRectangleShape) {
			if (
				this.dragOrigin &&
				distanceBetween(this.dragOrigin, this.activeRectangleShape.points[2]) < 12
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

		this.undoStack = this.undoStack.slice(0, -1);
		this.shapes = cloneShapes(previous.shapes);
		this.draft = previous.draft ? cloneShape(previous.draft) : null;
		this.phase = previous.phase;
		this.activePencilShape = null;
		this.activeRectangleShape = null;
		this.dragOrigin = null;
		this.isDragging = false;
		this.status = 'Undid recent action.';
		this.render();
	}

	clearDrawing() {
		if (!this.hasDrawing) return;
		this.pushHistory();
		this.shapes = [];
		this.draft = null;
		this.routeError = '';
		this.phase = 'editing';
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
			this.undo();
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
		// Routing will be re-implemented from scratch.
	}

	backToEditing() {
		// Routing will be re-implemented from scratch.
	}

	downloadGpx() {
		// GPX export will be re-implemented with routing.
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
				const next = [...shape.points];
				next[pointIndex] = point;
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
				this.updateShapeVertex(shapeId, pointIndex, point, isDraft)
		);
	}

	private pushHistory() {
		this.undoStack = [...this.undoStack.slice(-(MAX_UNDO - 1)), this.snapshot()];
	}

	private snapshot(): Snapshot {
		return {
			draft: this.draft ? cloneShape(this.draft) : null,
			phase: this.phase,
			shapes: cloneShapes(this.shapes)
		};
	}
}
