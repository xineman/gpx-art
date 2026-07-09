// Screen-space placement of directional "trail blazes" along a routed
// polyline. Pure geometry only — the renderer projects lat/lng → layer
// pixels, calls these helpers, then converts chevron polygons back.

export type ScreenPoint = { x: number; y: number };

/** Axis-aligned box in the same layer-pixel space as ScreenPoint. */
export type ScreenViewport = {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
};

export type ChevronPlacement = {
	/** Placement center on the path (chevron tip is offset along angle). */
	x: number;
	y: number;
	/** Travel bearing in screen radians: 0 = east, positive = clockwise
	 *  (map canvas y-down pixel space). */
	angle: number;
};

export type PlaceChevronsOptions = {
	/** Target gap between successive chevrons, in screen pixels. */
	spacing: number;
	/** Path-distance window used to estimate a stable bearing (not a
	 *  per-segment filter — densified OSRM edges can be 1–3 px at city
	 *  zoom, so skipping short edges would wipe every chevron). */
	bearingWindow: number;
	/** Cap on returned placements. When a viewport is supplied this is a
	 *  cap on *visible* marks; without one it still limits from path start
	 *  (so always pass the map viewport at high zoom). */
	maxCount: number;
	/** Preferred pad from path start; clamped to a fraction of total
	 *  length so short on-screen routes still get marks. */
	startPad: number;
	/** Preferred pad from path end; same clamp as startPad. */
	endPad: number;
	/** Minimum total path length (px) before any chevrons are drawn. */
	minPathLength: number;
};

export const DEFAULT_CHEVRON_OPTIONS: PlaceChevronsOptions = {
	spacing: 56,
	bearingWindow: 18,
	maxCount: 120,
	startPad: 40,
	endPad: 40,
	minPathLength: 28
};

// Half-width of the chevron V in screen pixels. Size is visual constant
// across zoom so the marks read as map chrome, not geography.
export const CHEVRON_SIZE_PX = 7;

// Pads never consume more than this fraction of the path each, so a
// city-scale view of a short ride still has a placeable middle.
const MAX_PAD_FRACTION = 0.22;

/**
 * Walk a screen-space polyline and place chevrons at roughly equal pixel
 * intervals. Returns empty when the path is too short to show direction.
 *
 * Placement is driven by cumulative path length, not per-edge length, so
 * densified OSRM geometry (many sub-pixel hops at low zoom) still yields
 * evenly spaced marks.
 *
 * Pass `viewport` (map bounds in layer pixels, typically padded) so that at
 * high zoom — where the full path can be tens of thousands of pixels — the
 * maxCount budget is spent on marks actually on screen, not only the first
 * few kilometres from the path start.
 */
export function placeChevronsAlongPath(
	points: readonly ScreenPoint[],
	options: PlaceChevronsOptions = DEFAULT_CHEVRON_OPTIONS,
	viewport?: ScreenViewport
): ChevronPlacement[] {
	if (points.length < 2) return [];

	const { spacing, bearingWindow, maxCount, startPad, endPad, minPathLength } = options;
	if (spacing <= 0 || maxCount <= 0) return [];

	const cum = cumulativeLengths(points);
	const total = cum[cum.length - 1];
	if (total < minPathLength) return [];

	// Shrink pads on short on-screen paths so we don't require ~80 px of
	// free ends before the first mark appears (city zoom of a neighbourhood
	// route is often only 80–150 px long).
	const maxPad = total * MAX_PAD_FRACTION;
	const padStart = Math.min(startPad, maxPad);
	const padEnd = Math.min(endPad, maxPad);
	const firstAt = padStart;
	const lastPlaceable = total - padEnd;
	if (lastPlaceable < firstAt) return [];

	// On very short placeable spans, tighten spacing so at least one or two
	// marks land instead of overshooting the whole middle in one step.
	const placeable = lastPlaceable - firstAt;
	const step = placeable < spacing ? Math.max(placeable, minPathLength * 0.5) : spacing;

	// When the map viewport is known, only walk path-distance ranges whose
	// edges can intersect it. At close zoom the full route is enormous in
	// screen px; without this we either (a) blow maxCount on the start of
	// the path far off-screen, or (b) iterate hundreds of thousands of slots.
	const ranges = viewport
		? visiblePathRanges(points, cum, viewport, firstAt, lastPlaceable, step)
		: [{ from: firstAt, to: lastPlaceable }];

	const placements: ChevronPlacement[] = [];
	for (const range of ranges) {
		// Snap the first candidate onto the global spacing lattice so marks
		// stay evenly spaced along the whole route, not re-zeroed per span.
		let at = firstAt + Math.ceil((range.from - firstAt) / step) * step;
		if (at < range.from - 1e-6) at += step;

		for (; at <= range.to + 1e-6 && placements.length < maxCount; at += step) {
			const center = pointAt(points, cum, at);
			if (viewport && !contains(viewport, center)) continue;
			const angle = bearingAt(points, cum, at, bearingWindow, total);
			if (!Number.isFinite(angle)) continue;
			placements.push({ x: center.x, y: center.y, angle });
		}
		if (placements.length >= maxCount) break;
	}

	return placements;
}

/**
 * Three screen points forming an open V chevron: left wing → tip → right wing.
 * The tip points along `angle` (direction of travel).
 */
export function chevronVertices(
	center: ScreenPoint,
	angle: number,
	size: number = CHEVRON_SIZE_PX
): [ScreenPoint, ScreenPoint, ScreenPoint] {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	// Perpendicular in screen space (y-down): rotate 90° clockwise.
	const px = -s;
	const py = c;

	// Tip sits slightly ahead of the placement center so the mark feels
	// anchored on the stroke rather than straddling it.
	const tip: ScreenPoint = {
		x: center.x + c * size * 0.35,
		y: center.y + s * size * 0.35
	};
	const backX = tip.x - c * size;
	const backY = tip.y - s * size;
	const wing = size * 0.7;

	return [
		{ x: backX + px * wing, y: backY + py * wing },
		tip,
		{ x: backX - px * wing, y: backY - py * wing }
	];
}

/** Cumulative path length at each vertex; cum[0] === 0. */
function cumulativeLengths(points: readonly ScreenPoint[]): number[] {
	const cum = new Array<number>(points.length);
	cum[0] = 0;
	for (let i = 1; i < points.length; i++) {
		cum[i] = cum[i - 1] + dist(points[i - 1], points[i]);
	}
	return cum;
}

/**
 * Path-distance ranges whose segments can meet the viewport. Expanded by
 * one spacing step so marks near the edge of the screen are not dropped.
 */
function visiblePathRanges(
	points: readonly ScreenPoint[],
	cum: readonly number[],
	viewport: ScreenViewport,
	firstAt: number,
	lastPlaceable: number,
	step: number
): { from: number; to: number }[] {
	const pad = step;
	const ranges: { from: number; to: number }[] = [];

	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		if (!segmentMayHitViewport(a, b, viewport)) continue;

		const from = Math.max(firstAt, cum[i - 1] - pad);
		const to = Math.min(lastPlaceable, cum[i] + pad);
		if (to < from) continue;

		const last = ranges[ranges.length - 1];
		if (last && from <= last.to + step) {
			last.to = Math.max(last.to, to);
		} else {
			ranges.push({ from, to });
		}
	}

	return ranges;
}

/** Cheap AABB test: segment's bounding box overlaps the viewport. */
function segmentMayHitViewport(a: ScreenPoint, b: ScreenPoint, vp: ScreenViewport): boolean {
	const minX = Math.min(a.x, b.x);
	const maxX = Math.max(a.x, b.x);
	const minY = Math.min(a.y, b.y);
	const maxY = Math.max(a.y, b.y);
	return minX <= vp.maxX && maxX >= vp.minX && minY <= vp.maxY && maxY >= vp.minY;
}

function contains(vp: ScreenViewport, p: ScreenPoint): boolean {
	return p.x >= vp.minX && p.x <= vp.maxX && p.y >= vp.minY && p.y <= vp.maxY;
}

/** Interpolate a point at path-distance `at` along the polyline. */
function pointAt(points: readonly ScreenPoint[], cum: readonly number[], at: number): ScreenPoint {
	const total = cum[cum.length - 1];
	const target = Math.max(0, Math.min(total, at));
	if (target <= 0) return points[0];
	if (target >= total) return points[points.length - 1];

	// Binary search: first index i with cum[i] >= target.
	let lo = 1;
	let hi = cum.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (cum[mid] < target) lo = mid + 1;
		else hi = mid;
	}
	const i = lo;
	const segStart = cum[i - 1];
	const segLen = cum[i] - segStart;
	if (segLen < 1e-9) return points[i];
	const t = (target - segStart) / segLen;
	const a = points[i - 1];
	const b = points[i];
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Bearing at path-distance `at`, estimated over a window of path length so
 * single sub-pixel densified edges don't yield NaN / noisy angles.
 */
function bearingAt(
	points: readonly ScreenPoint[],
	cum: readonly number[],
	at: number,
	window: number,
	total: number
): number {
	const half = Math.max(window, 1) / 2;
	const a = pointAt(points, cum, Math.max(0, at - half));
	const b = pointAt(points, cum, Math.min(total, at + half));
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	if (dx * dx + dy * dy < 1e-12) {
		// Degenerate window (collapsed path) — fall back to nearest non-zero edge.
		for (let i = 1; i < points.length; i++) {
			const edx = points[i].x - points[i - 1].x;
			const edy = points[i].y - points[i - 1].y;
			if (edx * edx + edy * edy >= 1e-12) return Math.atan2(edy, edx);
		}
		return NaN;
	}
	return Math.atan2(dy, dx);
}

function dist(a: ScreenPoint, b: ScreenPoint): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return Math.hypot(dx, dy);
}
