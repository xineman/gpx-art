import type { Position } from 'geojson';

/** Same-spot re-tap within this window finishes polyline / polygon. */
export const DOUBLE_TAP_MS = 350;
/** Screen-pixel radius for “same spot” / re-tap last vertex. */
export const TAP_PX = 28;

export type ScreenPoint = { x: number; y: number };

export function screenDistSq(a: ScreenPoint, b: ScreenPoint): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return dx * dx + dy * dy;
}

export function isWithinPx(a: ScreenPoint, b: ScreenPoint, px = TAP_PX): boolean {
	return screenDistSq(a, b) <= px * px;
}

/**
 * True when `now` / `screen` look like the second half of a double-tap
 * relative to a previous tap.
 */
export function isDoubleTap(
	prev: { t: number; screen: ScreenPoint } | null,
	now: number,
	screen: ScreenPoint,
	maxMs = DOUBLE_TAP_MS,
	maxPx = TAP_PX
): boolean {
	if (!prev) return false;
	if (now - prev.t > maxMs) return false;
	return isWithinPx(prev.screen, screen, maxPx);
}

/**
 * Decide what a vertex-tool click should do.
 *
 * Order matters: re-tap last vertex (any delay) finishes without undoing,
 * so “double-tap last point to finish” works at the minimum vertex count.
 * A quick double-tap *elsewhere* undoes the accidental second vertex then finishes.
 */
export type VertexClickAction = 'finish-last' | 'finish-double-tap-undo' | 'place';

export function resolveVertexClick(opts: {
	canFinish: boolean;
	/** Screen position of the last committed vertex, or null if none. */
	lastVertexScreen: ScreenPoint | null;
	screen: ScreenPoint;
	lastTap: { t: number; screen: ScreenPoint } | null;
	now: number;
}): VertexClickAction {
	const { canFinish, lastVertexScreen, screen, lastTap, now } = opts;
	if (lastVertexScreen && canFinish && isWithinPx(screen, lastVertexScreen)) {
		return 'finish-last';
	}
	if (isDoubleTap(lastTap, now, screen)) {
		return 'finish-double-tap-undo';
	}
	return 'place';
}

/** GeoJSON position → something MapLibre `project` accepts. */
export function toLngLat(point: Position): { lng: number; lat: number } {
	return { lng: point[0] as number, lat: point[1] as number };
}
