import type { LineString } from 'geojson';
import type { ToolId } from '#lib/state/tools.svelte.js';
import {
	canFinishVertices,
	type Draft,
	type DragDraft,
	type DrawingPosition,
	type VertexDraft
} from './draft';
import { closedLineString, lineString, rectangleLineString, shouldSample } from './geo';
import { isDoubleTap, isWithinPx, resolveVertexClick, type ScreenPoint } from './tap';

export type PointerKind = 'mouse' | 'touch';
export type DrawingInput =
	| { type: 'dragStart'; pointer: PointerKind; position: DrawingPosition }
	| { type: 'dragMove'; pointer: PointerKind; position: DrawingPosition | null }
	| { type: 'dragEnd'; pointer: PointerKind; position: DrawingPosition | null }
	| { type: 'dragCancel'; pointer: PointerKind }
	| { type: 'tap'; position: DrawingPosition; time: number; clickCount: number }
	| { type: 'doubleClick' }
	| { type: 'finish' }
	| { type: 'cancel' };

export type DrawingEvent =
	DrawingInput | { type: 'selectTool'; tool: ToolId } | { type: 'setPanning'; enabled: boolean };

type DrawingUpdate = {
	consume?: true;
	previewChanged?: true;
	interactionChanged?: true;
	commit?: { geometry: LineString; tool: Draft['kind'] };
};

type Tap = { t: number; screen: ScreenPoint };
type DragGesture = { kind: 'dragging'; pointer: PointerKind; draft: DragDraft };
type VertexGesture = { kind: 'placingVertices'; draft: VertexDraft; lastTap: Tap | null };
type Gesture = { kind: 'idle' } | DragGesture | VertexGesture;

const previewChanged = { previewChanged: true } as const;

/** Owns the gesture and returns the effects for the controller to apply. */
export class DrawingSession {
	#tool: ToolId = 'pencil';
	#temporaryPan = false;
	#gesture: Gesture = { kind: 'idle' };
	// A native click can follow a tap that already completed the draft.
	#completionTap: Tap | null = null;
	#project: (position: DrawingPosition) => ScreenPoint;

	constructor(project: (position: DrawingPosition) => ScreenPoint) {
		this.#project = project;
	}

	get draft(): Draft | null {
		return this.#gesture.kind === 'idle' ? null : this.#gesture.draft;
	}

	get activePointer(): PointerKind | null {
		return this.#gesture.kind === 'dragging' ? this.#gesture.pointer : null;
	}

	get panning(): boolean {
		return this.#temporaryPan || this.#tool === 'pan';
	}

	dispatch(event: DrawingEvent): DrawingUpdate | undefined {
		switch (event.type) {
			case 'selectTool':
				if (this.#tool === event.tool) return;
				this.#tool = event.tool;
				return { ...this.#cancel(), interactionChanged: true };
			case 'setPanning':
				if (this.#temporaryPan === event.enabled) return;
				this.#temporaryPan = event.enabled;
				return this.#gesture.kind === 'dragging'
					? { ...this.#cancel(), interactionChanged: true }
					: { interactionChanged: true };
			case 'cancel':
				return this.#cancel();
			case 'dragCancel':
				if (this.activePointer === event.pointer) return this.#cancel();
				return;
			case 'dragStart':
				return this.#startDrag(event.pointer, event.position);
			case 'dragMove':
				return this.#move(event.pointer, event.position);
			case 'dragEnd':
				if (this.#gesture.kind === 'dragging' && this.#gesture.pointer === event.pointer) {
					return this.#finishDrag(this.#gesture.draft, event.position);
				}
				return;
			case 'tap':
				return this.#tap(event);
			case 'doubleClick':
				if (this.panning || (this.#tool !== 'polyline' && this.#tool !== 'polygon')) return;
				// Native double-click fallback, after the two click events placed vertices.
				return { ...this.#finishVertices({ discard: 2 }), consume: true };
			case 'finish':
				return this.#finishVertices();
		}
	}

	#cancel(): DrawingUpdate {
		this.#gesture = { kind: 'idle' };
		this.#completionTap = null;
		return previewChanged;
	}

	#startDrag(pointer: PointerKind, position: DrawingPosition): DrawingUpdate | undefined {
		const tool = this.#tool;
		if (this.panning || (tool !== 'pencil' && tool !== 'rectangle')) return;
		if (this.activePointer && this.activePointer !== pointer) return;

		const draft: DragDraft =
			tool === 'pencil'
				? { kind: tool, points: [position] }
				: { kind: tool, start: position, end: position };
		this.#gesture = { kind: 'dragging', pointer, draft };
		return { previewChanged: true, consume: true };
	}

	#move(pointer: PointerKind, position: DrawingPosition | null): DrawingUpdate | undefined {
		const gesture = this.#gesture;
		if (gesture.kind === 'placingVertices' && pointer === 'mouse' && position) {
			gesture.draft.cursor = position;
			return previewChanged;
		}
		if (gesture.kind !== 'dragging' || gesture.pointer !== pointer) return;

		const consume: DrawingUpdate | undefined = pointer === 'touch' ? { consume: true } : undefined;
		if (!position) return consume;
		const draft = gesture.draft;
		if (draft.kind === 'rectangle') {
			draft.end = position;
		} else {
			if (!shouldSample(draft.points.at(-1), position)) return consume;
			// Append in place to avoid copying the full stroke on each sample.
			draft.points.push(position);
		}
		return { ...consume, previewChanged: true };
	}

	#finishDrag(draft: DragDraft, position: DrawingPosition | null): DrawingUpdate {
		this.#cancel();
		if (draft.kind === 'rectangle') {
			const { start } = draft;
			const end = position ?? draft.end;
			if (start[0] === end[0] || start[1] === end[1]) return previewChanged;
			return {
				previewChanged: true,
				commit: { geometry: rectangleLineString(start, end), tool: draft.kind }
			};
		}

		const points = draft.points;
		const last = points.at(-1);
		const closed = this.#endpointsAreNear(points, position ?? last);
		// A release point hugging the start vertex is redundant on a closed ring.
		if (position && !closed && shouldSample(last, position, 0)) points.push(position);
		if (points.length < 2) return previewChanged;
		return {
			previewChanged: true,
			commit: { geometry: closed ? closedLineString(points) : lineString(points), tool: draft.kind }
		};
	}

	#tap({
		position,
		time,
		clickCount
	}: Extract<DrawingInput, { type: 'tap' }>): DrawingUpdate | undefined {
		const tool = this.#tool;
		if (this.panning || (tool !== 'polyline' && tool !== 'polygon')) return;

		const screen = this.#project(position);
		const previousCompletion = this.#completionTap;
		this.#completionTap = null;
		const pairedClick =
			previousCompletion && clickCount > 1 && isWithinPx(previousCompletion.screen, screen);
		if (pairedClick || isDoubleTap(previousCompletion, time, screen)) {
			return { consume: true };
		}

		const tap = { t: time, screen };
		const gesture = this.#gesture;
		if (gesture.kind !== 'placingVertices') {
			this.#gesture = {
				kind: 'placingVertices',
				draft: { kind: tool, points: [position], cursor: position },
				lastTap: tap
			};
			return previewChanged;
		}

		const { points } = gesture.draft;
		const first = points[0];
		const last = points.at(-1);
		const action = resolveVertexClick({
			canFinish: canFinishVertices(tool, points.length),
			firstVertexScreen: first && points.length >= 3 ? this.#project(first) : null,
			lastVertexScreen: last ? this.#project(last) : null,
			screen,
			lastTap: gesture.lastTap,
			now: time
		});

		switch (action) {
			case 'close-first':
				return { ...this.#finishVertices({ close: true, tap }), consume: true };
			case 'finish-last':
				return { ...this.#finishVertices({ tap }), consume: true };
			case 'finish-double-tap-undo':
				return { ...this.#finishVertices({ discard: 1, tap }), consume: true };
			case 'place':
				points.push(position);
				gesture.draft.cursor = position;
				gesture.lastTap = tap;
				return previewChanged;
		}
	}

	#finishVertices({
		close = false,
		discard = 0,
		tap = null
	}: { close?: boolean; discard?: number; tap?: Tap | null } = {}): DrawingUpdate | undefined {
		const gesture = this.#gesture;
		if (gesture.kind !== 'placingVertices') return;

		const { kind: tool, points } = gesture.draft;
		if (!canFinishVertices(tool, points.length - discard)) {
			// Retain the vertices and let the next tap place another point.
			gesture.lastTap = null;
			return previewChanged;
		}

		const finalPoints = discard === 0 ? points : points.slice(0, -discard);
		const closed = close || tool === 'polygon' || this.#endpointsAreNear(finalPoints);
		this.#gesture = { kind: 'idle' };
		this.#completionTap = tap;
		return {
			previewChanged: true,
			commit: {
				geometry: closed ? closedLineString(finalPoints) : lineString(finalPoints),
				tool
			}
		};
	}

	#endpointsAreNear(points: DrawingPosition[], end = points.at(-1)): boolean {
		const first = points[0];
		return (
			points.length >= 3 && !!first && !!end && isWithinPx(this.#project(first), this.#project(end))
		);
	}
}
