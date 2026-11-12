import type { Map as MaplibreMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import { routeWaypointAtPoint } from '#lib/map/waypoint-hit.js';
import type { DrawingPosition } from './draft';
import type { DrawingInput, PointerKind } from './session';

type DispatchInput = (event: DrawingInput, original?: Pick<Event, 'preventDefault'>) => void;

function mousePosition(event: MapMouseEvent): DrawingPosition {
	return [event.lngLat.lng, event.lngLat.lat];
}

function touchPosition(event: MapTouchEvent): DrawingPosition | null {
	const position = event.lngLat ?? event.lngLats[0];
	return position ? [position.lng, position.lat] : null;
}

/** Translate MapLibre and window input, including releases outside the canvas. */
export class MapDrawingInput {
	#map: MaplibreMap;
	#dispatch: DispatchInput;
	#releaseCapture: (() => void) | undefined;

	constructor(map: MaplibreMap, dispatch: DispatchInput) {
		this.#map = map;
		this.#dispatch = dispatch;
	}

	attach() {
		const map = this.#map;
		map.on('mousedown', this.#onMouseDown);
		map.on('mousemove', this.#onMouseMove);
		map.on('mouseup', this.#onMouseUp);
		map.on('touchstart', this.#onTouchStart);
		map.on('touchmove', this.#onTouchMove);
		map.on('touchend', this.#onTouchEnd);
		map.on('touchcancel', this.#onTouchCancel);
		map.on('click', this.#onClick);
		map.on('dblclick', this.#onDoubleClick);
		window.addEventListener('keydown', this.#onKeyDown);
	}

	detach() {
		const map = this.#map;
		map.off('mousedown', this.#onMouseDown);
		map.off('mousemove', this.#onMouseMove);
		map.off('mouseup', this.#onMouseUp);
		map.off('touchstart', this.#onTouchStart);
		map.off('touchmove', this.#onTouchMove);
		map.off('touchend', this.#onTouchEnd);
		map.off('touchcancel', this.#onTouchCancel);
		map.off('click', this.#onClick);
		map.off('dblclick', this.#onDoubleClick);
		window.removeEventListener('keydown', this.#onKeyDown);
		this.capture(null);
	}

	capture(pointer: PointerKind | null) {
		this.#releaseCapture?.();
		this.#releaseCapture = undefined;

		if (pointer === 'mouse') {
			window.addEventListener('mousemove', this.#onWindowMouseMove);
			window.addEventListener('mouseup', this.#onWindowMouseUp);
			this.#releaseCapture = () => {
				window.removeEventListener('mousemove', this.#onWindowMouseMove);
				window.removeEventListener('mouseup', this.#onWindowMouseUp);
			};
		} else if (pointer === 'touch') {
			window.addEventListener('touchmove', this.#onWindowTouchMove, { passive: false });
			window.addEventListener('touchend', this.#onWindowTouchEnd);
			window.addEventListener('touchcancel', this.#onTouchCancel);
			this.#releaseCapture = () => {
				window.removeEventListener('touchmove', this.#onWindowTouchMove);
				window.removeEventListener('touchend', this.#onWindowTouchEnd);
				window.removeEventListener('touchcancel', this.#onTouchCancel);
			};
		}
	}

	#onMouseDown = (event: MapMouseEvent) => {
		if (event.originalEvent.button !== 0 || routeWaypointAtPoint(this.#map, event.point) != null)
			return;
		this.#dispatch({ type: 'dragStart', pointer: 'mouse', position: mousePosition(event) }, event);
	};

	#onMouseMove = (event: MapMouseEvent) => {
		this.#dispatch({ type: 'dragMove', pointer: 'mouse', position: mousePosition(event) });
	};

	#onMouseUp = (event: MapMouseEvent) => {
		this.#dispatch({ type: 'dragEnd', pointer: 'mouse', position: mousePosition(event) });
	};

	#onTouchStart = (event: MapTouchEvent) => {
		const first = event.points[0];
		if (first && routeWaypointAtPoint(this.#map, first) != null) return;
		// A second finger interrupts drawing so the map can handle the pinch.
		if (event.points.length !== 1) {
			this.#onTouchCancel();
			return;
		}
		const position = touchPosition(event);
		if (position) this.#dispatch({ type: 'dragStart', pointer: 'touch', position }, event);
	};

	#onTouchMove = (event: MapTouchEvent) => {
		const position = touchPosition(event);
		if (position) this.#dispatch({ type: 'dragMove', pointer: 'touch', position }, event);
	};

	#onTouchEnd = (event: MapTouchEvent) => {
		if (event.originalEvent.touches.length > 0) return;
		this.#dispatch({ type: 'dragEnd', pointer: 'touch', position: touchPosition(event) });
	};

	#onTouchCancel = () => {
		this.#dispatch({ type: 'dragCancel', pointer: 'touch' });
	};

	#onWindowMouseMove = (event: MouseEvent) => {
		const position = this.#positionFromClient(event.clientX, event.clientY);
		this.#dispatch({ type: 'dragMove', pointer: 'mouse', position });
	};

	#onWindowMouseUp = (event: MouseEvent) => {
		const position = this.#positionFromClient(event.clientX, event.clientY);
		this.#dispatch({ type: 'dragEnd', pointer: 'mouse', position });
	};

	#onWindowTouchMove = (event: TouchEvent) => {
		const position = this.#positionFromTouch(event);
		this.#dispatch({ type: 'dragMove', pointer: 'touch', position }, event);
	};

	#onWindowTouchEnd = (event: TouchEvent) => {
		if (event.touches.length > 0) return;
		const position = this.#positionFromTouch(event);
		this.#dispatch({ type: 'dragEnd', pointer: 'touch', position });
	};

	#onClick = (event: MapMouseEvent) => {
		if (routeWaypointAtPoint(this.#map, event.point) != null) return;
		this.#dispatch(
			{
				type: 'tap',
				position: mousePosition(event),
				time: performance.now(),
				clickCount: event.originalEvent.detail
			},
			event
		);
	};

	#onDoubleClick = (event: MapMouseEvent) => {
		if (routeWaypointAtPoint(this.#map, event.point) != null) return;
		this.#dispatch({ type: 'doubleClick' }, event);
	};

	#onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') this.#dispatch({ type: 'cancel' });
		if (event.key === 'Enter') this.#dispatch({ type: 'finish' });
	};

	#positionFromClient(clientX: number, clientY: number): DrawingPosition {
		const { left, top } = this.#map.getCanvas().getBoundingClientRect();
		const { lng, lat } = this.#map.unproject([clientX - left, clientY - top]);
		return [lng, lat];
	}

	#positionFromTouch(event: TouchEvent): DrawingPosition | null {
		const touch = event.changedTouches[0] ?? event.touches[0];
		return touch ? this.#positionFromClient(touch.clientX, touch.clientY) : null;
	}
}
