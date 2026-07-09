import {
	ROUTE_CLEAN_MAX_BRIDGES,
	ROUTE_CLEAN_SPANS_PER_PASS,
	ROUTE_HAIRPIN_MAX_COSINE,
	ROUTE_HAIRPIN_MIN_LEG_METERS,
	ROUTE_CORNER_MIN_PATH_METERS,
	ROUTE_CORNER_MIN_PATH_TO_CHORD,
	ROUTE_CORNER_RADIUS_METERS,
	ROUTE_LOCAL_DETOUR_MIN_METERS,
	ROUTE_LOCAL_DETOUR_MIN_RATIO,
	ROUTE_LOCAL_DETOUR_NEAR_METERS,
	ROUTE_LOOP_MAX_METERS,
	ROUTE_LOOP_MIN_METERS,
	ROUTE_LOOP_NEAR_METERS,
	ROUTE_LOOP_WINDOW,
	ROUTE_SPUR_MAX_PATH_TO_REACH,
	ROUTE_SPUR_MIN_DETOUR,
	ROUTE_SPUR_MIN_PATH_TO_REACH
} from '$lib/constants/routing';
import { distanceBetween, turnCosine } from '$lib/geometry/distance';
import type { Point } from '$lib/types/sketch';
import { getRoute } from './osrm';
import { decodePolyline } from './polyline';

/** Bridge two kept endpoints via the road network. null = leave span unchanged. */
export type SegmentRouter = (from: Point, to: Point) => Promise<Point[] | null>;

// Default: OSRM /route between two points. Returns null on failure so the
// caller keeps the original on-network spur rather than a free chord.
export async function routeSegmentOnNetwork(from: Point, to: Point): Promise<Point[] | null> {
	if (distanceBetween(from, to) <= 2) return [from];
	try {
		const { geometry } = await getRoute([from, to]);
		const decoded = decodePolyline(geometry);
		return decoded.length >= 2 ? decoded : null;
	} catch {
		return null;
	}
}

export type LoopSpan = { m: number; j: number; severity?: number };

function maxReachFrom(pts: Point[], m: number, j: number): number {
	let maxReach = 0;
	for (let k = m + 1; k < j; k++) {
		const d = distanceBetween(pts[m], pts[k]);
		if (d > maxReach) maxReach = d;
	}
	return maxReach;
}

// Thin out-and-back (Parkowa): rejoin near the same point, path ≈ 2× reach.
export function isReverseSpur(
	pts: Point[],
	m: number,
	j: number,
	pathLen: number,
	nearMeters = ROUTE_LOOP_NEAR_METERS
): boolean {
	if (j - m < 3) return false;
	if (pathLen < ROUTE_LOOP_MIN_METERS || pathLen > ROUTE_LOOP_MAX_METERS) return false;

	const chord = Math.max(distanceBetween(pts[m], pts[j]), 1);
	if (chord > nearMeters) return false;
	if (pathLen / chord < ROUTE_SPUR_MIN_DETOUR) return false;

	const maxReach = maxReachFrom(pts, m, j);
	if (maxReach < ROUTE_LOOP_MIN_METERS * 0.35) return false;

	const ratio = pathLen / maxReach;
	return ratio >= ROUTE_SPUR_MIN_PATH_TO_REACH && ratio <= ROUTE_SPUR_MAX_PATH_TO_REACH;
}

// Wider corner-approach loop (NW Powązkowska): rejoin further along the
// corridor after a wasteful wander. chord can be up to ~200 m.
export function isLocalDetour(
	pts: Point[],
	m: number,
	j: number,
	pathLen: number
): boolean {
	if (j - m < 4) return false;
	if (pathLen < ROUTE_LOCAL_DETOUR_MIN_METERS || pathLen > ROUTE_LOOP_MAX_METERS) return false;

	const chord = Math.max(distanceBetween(pts[m], pts[j]), 1);
	if (chord > ROUTE_LOCAL_DETOUR_NEAR_METERS) return false;
	if (pathLen / chord < ROUTE_LOCAL_DETOUR_MIN_RATIO) return false;

	const maxReach = maxReachFrom(pts, m, j);
	// Must actually leave the chord corridor (not a long straight road).
	if (maxReach < chord * 0.45) return false;
	// pathLen should not be a huge multi-block circuit (those have larger ratio).
	const reachRatio = pathLen / Math.max(maxReach, 1);
	return reachRatio >= 1.45 && reachRatio <= 3.4;
}

export function isCollapsibleSpan(
	pts: Point[],
	m: number,
	j: number,
	pathLen: number
): boolean {
	return isReverseSpur(pts, m, j, pathLen) || isLocalDetour(pts, m, j, pathLen);
}

// Severity: prioritize long wasteful loops over micro-wiggles.
export function spurSeverity(pathLen: number, chord: number): number {
	return pathLen * (pathLen / Math.max(chord, 1));
}

// Detect reverse spurs + local detours; return non-overlapping spans ordered
// by severity (worst first).
export function findLoopSpans(
	pts: Point[],
	windowSize = ROUTE_LOOP_WINDOW,
	_nearMeters = ROUTE_LOOP_NEAR_METERS,
	minLoopMeters = ROUTE_LOOP_MIN_METERS
): LoopSpan[] {
	if (pts.length < 4) return [];

	const prefix = new Array(pts.length).fill(0);
	for (let i = 1; i < pts.length; i++) {
		prefix[i] = prefix[i - 1] + distanceBetween(pts[i - 1], pts[i]);
	}

	const candidates: LoopSpan[] = [];
	// Collect best m per j, then rank globally by severity.
	for (let j = 3; j < pts.length; j++) {
		const windowStart = Math.max(0, j - windowSize);
		let bestM = -1;
		let bestSev = -1;

		for (let m = windowStart; m <= j - 3; m++) {
			const span = prefix[j] - prefix[m];
			if (span < minLoopMeters) continue;
			if (!isCollapsibleSpan(pts, m, j, span)) continue;
			const chord = Math.max(distanceBetween(pts[m], pts[j]), 1);
			const sev = spurSeverity(span, chord);
			if (sev > bestSev) {
				bestSev = sev;
				bestM = m;
			}
		}

		if (bestM >= 0) {
			candidates.push({ m: bestM, j, severity: bestSev });
		}
	}

	// Worst first.
	candidates.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));

	// Greedy non-overlapping, preserving severity order.
	const spans: LoopSpan[] = [];
	const taken: Array<[number, number]> = [];
	for (const c of candidates) {
		if (taken.some(([lo, hi]) => !(c.j <= lo || c.m >= hi))) continue;
		spans.push(c);
		taken.push([c.m, c.j]);
	}

	// applyNetworkSpans expects ascending m for splicing.
	return spans.slice().sort((a, b) => a.m - b.m);
}

// Pure geometric loop collapse (chord joins). Prefer cleanRoutedPathOnNetwork
// in production so joins stay on the road graph.
export function removeShortLoops(
	points: Point[],
	windowSize = ROUTE_LOOP_WINDOW,
	nearMeters = ROUTE_LOOP_NEAR_METERS,
	minLoopMeters = ROUTE_LOOP_MIN_METERS
): Point[] {
	if (points.length < 4) return points.slice();

	let pts = points.slice();
	for (let pass = 0; pass < 3; pass++) {
		const spans = findLoopSpans(pts, windowSize, nearMeters, minLoopMeters);
		if (spans.length === 0) break;
		pts = applyChordSpans(pts, spans);
	}
	return pts;
}

export function removeHairpins(
	points: Point[],
	minLegMeters = ROUTE_HAIRPIN_MIN_LEG_METERS,
	maxCosine = ROUTE_HAIRPIN_MAX_COSINE,
	maxIterations = 6
): Point[] {
	if (points.length < 3) return points.slice();

	let pts = points.slice();
	for (let iter = 0; iter < maxIterations; iter++) {
		if (pts.length < 3) break;
		const keep = new Array(pts.length).fill(true);
		let removed = false;

		for (let i = 1; i < pts.length - 1; i++) {
			if (!keep[i - 1]) continue;
			const dIn = distanceBetween(pts[i - 1], pts[i]);
			const dOut = distanceBetween(pts[i], pts[i + 1]);
			if (dIn < minLegMeters || dOut < minLegMeters) continue;

			const cos = turnCosine(pts[i - 1], pts[i], pts[i + 1]);
			if (cos <= maxCosine) {
				keep[i] = false;
				removed = true;
				i++;
			}
		}

		if (!removed) break;
		pts = pts.filter((_, i) => keep[i]);
	}

	return pts;
}

export function findHairpinApexes(
	pts: Point[],
	minLegMeters = ROUTE_HAIRPIN_MIN_LEG_METERS,
	maxCosine = ROUTE_HAIRPIN_MAX_COSINE
): number[] {
	const apexes: number[] = [];
	for (let i = 1; i < pts.length - 1; i++) {
		const dIn = distanceBetween(pts[i - 1], pts[i]);
		const dOut = distanceBetween(pts[i], pts[i + 1]);
		if (dIn < minLegMeters || dOut < minLegMeters) continue;
		if (turnCosine(pts[i - 1], pts[i], pts[i + 1]) <= maxCosine) {
			apexes.push(i);
			i++;
		}
	}
	return apexes;
}

function applyChordSpans(pts: Point[], spans: LoopSpan[]): Point[] {
	// spans must be sorted by m ascending
	const sorted = spans.slice().sort((a, b) => a.m - b.m);
	const out: Point[] = [];
	let cursor = 0;
	for (const { m, j } of sorted) {
		if (m < cursor) continue;
		out.push(...pts.slice(cursor, m + 1));
		cursor = j;
	}
	out.push(...pts.slice(cursor));
	return out;
}

function samePoint(a: Point, b: Point): boolean {
	return distanceBetween(a, b) <= 2;
}

function stripBridgeEndpoints(bridged: Point[], from: Point, to: Point): Point[] {
	if (bridged.length < 2) return [];
	const start = samePoint(bridged[0], from) ? 1 : 0;
	const endExcl =
		bridged.length > start && samePoint(bridged[bridged.length - 1], to)
			? bridged.length - 1
			: bridged.length;
	return bridged.slice(start, endExcl);
}

function pathLenOf(points: Point[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		total += distanceBetween(points[i - 1], points[i]);
	}
	return total;
}

/**
 * Replace reverse-spur / detour spans with on-network bridges only.
 * Never inserts a free map chord between m and j (except zero-length when
 * m≈j — then there is nothing to join).
 */
async function applyNetworkSpans(
	pts: Point[],
	spans: LoopSpan[],
	route: SegmentRouter
): Promise<{ path: Point[]; replaced: number }> {
	if (spans.length === 0) return { path: pts, replaced: 0 };

	// Splice order: ascending m. Severity order already applied when selecting.
	const ordered = spans.slice().sort((a, b) => a.m - b.m);

	const bridges = await Promise.all(
		ordered.map(async ({ m, j }) => {
			let interiorLen = 0;
			for (let i = m + 1; i <= j; i++) {
				interiorLen += distanceBetween(pts[i - 1], pts[i]);
			}
			const chord = distanceBetween(pts[m], pts[j]);

			// Pure out-and-back to the same place: drop interior, no gap.
			if (chord <= 2) {
				return { m, j, insert: [] as Point[], drop: true };
			}

			// Prefer a road bridge. Try (m,j) first; if that is not shorter
			// than the spur, try slightly expanded anchors (still on path)
			// for a cleaner join — still always OSRM, never free chord.
			const attempts: Array<[number, number]> = [[m, j]];
			for (let expand = 1; expand <= 3; expand++) {
				const m2 = Math.max(0, m - expand);
				const j2 = Math.min(pts.length - 1, j + expand);
				if (m2 < j2 && (m2 !== m || j2 !== j)) attempts.push([m2, j2]);
			}

			let best: { m: number; j: number; insert: Point[]; bLen: number } | null = null;
			for (const [am, aj] of attempts) {
				const bridged = await route(pts[am], pts[aj]);
				if (!bridged || bridged.length < 2) continue;
				const insert = stripBridgeEndpoints(bridged, pts[am], pts[aj]);
				const bLen = pathLenOf([pts[am], ...insert, pts[aj]]);
				const skipped = (() => {
					let s = 0;
					for (let i = am + 1; i <= aj; i++) s += distanceBetween(pts[i - 1], pts[i]);
					return s;
				})();
				// Accept bridge if it shortens the skipped stretch, or is the
				// only attempt that succeeded (still on-network replacement).
				if (bLen <= skipped * 0.95 || best === null) {
					if (best === null || bLen < best.bLen) {
						best = { m: am, j: aj, insert, bLen };
					}
				}
				// Good enough — stop expanding.
				if (bLen <= skipped * 0.85) break;
			}

			if (best && best.bLen <= interiorLen * 1.05) {
				// On-network bridge replaces the spur/detour.
				return { m: best.m, j: best.j, insert: best.insert, drop: true };
			}

			// No usable bridge — keep original on-network interior (never free chord).
			return { m, j, insert: pts.slice(m + 1, j), drop: false };
		})
	);

	const out: Point[] = [];
	let cursor = 0;
	let replaced = 0;

	for (const { m, j, insert, drop } of bridges) {
		if (m < cursor) continue;
		out.push(...pts.slice(cursor, m + 1));
		if (drop) {
			replaced++;
			out.push(...insert);
		} else {
			out.push(...insert);
		}
		cursor = j;
	}
	out.push(...pts.slice(cursor));
	return { path: out, replaced };
}

function withBridgeBudget(route: SegmentRouter, maxBridges: number): {
	route: SegmentRouter;
	remaining: () => number;
} {
	let used = 0;
	return {
		remaining: () => Math.max(0, maxBridges - used),
		route: async (from, to) => {
			if (used >= maxBridges) return null;
			used++;
			return route(from, to);
		}
	};
}

async function collapseLoopsOnNetwork(
	pts: Point[],
	route: SegmentRouter,
	maxPasses = 5,
	spansPerPass = ROUTE_CLEAN_SPANS_PER_PASS
): Promise<Point[]> {
	let current = pts;
	for (let pass = 0; pass < maxPasses; pass++) {
		const spans = findLoopSpans(current);
		if (spans.length === 0) break;
		// findLoopSpans is severity-ranked then re-sorted by m for splicing.
		// Re-rank: take top severity non-overlapping up to spansPerPass.
		const bySev = spans.slice().sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
		const limited: LoopSpan[] = [];
		const taken: Array<[number, number]> = [];
		for (const s of bySev) {
			if (limited.length >= spansPerPass) break;
			if (taken.some(([lo, hi]) => !(s.j <= lo || s.m >= hi))) continue;
			limited.push(s);
			taken.push([s.m, s.j]);
		}
		const { path, replaced } = await applyNetworkSpans(current, limited, route);
		// Bridges can add points (full road geometry) while still removing reverse
		// travel — only stop when nothing was replaced.
		if (replaced === 0) break;
		current = path;
	}
	return current;
}

async function collapseHairpinsOnNetwork(
	pts: Point[],
	route: SegmentRouter,
	maxPasses = 2
): Promise<Point[]> {
	let current = pts;
	for (let pass = 0; pass < maxPasses; pass++) {
		const apexes = findHairpinApexes(current);
		if (apexes.length === 0) break;
		// Prefer longer hairpin legs (more severe) first.
		const scored = apexes.map((i) => {
			const leg =
				distanceBetween(current[i - 1], current[i]) +
				distanceBetween(current[i], current[i + 1]);
			return { i, leg };
		});
		scored.sort((a, b) => b.leg - a.leg);
		const spans: LoopSpan[] = [];
		const used = new Set<number>();
		for (const { i } of scored) {
			if (spans.length >= ROUTE_CLEAN_SPANS_PER_PASS) break;
			if (used.has(i - 1) || used.has(i) || used.has(i + 1)) continue;
			spans.push({ m: i - 1, j: i + 1 });
			used.add(i - 1);
			used.add(i);
			used.add(i + 1);
		}
		const { path, replaced } = await applyNetworkSpans(current, spans, route);
		if (replaced === 0) break;
		current = path;
	}
	return current;
}

/**
 * Wasteful route visits near a sketch corner: the path enters the corner's
 * neighborhood, wanders, then leaves. Collapse entry→exit when path ≫ chord.
 * Targets geometric vertices that force OSRM off a main street into a loop.
 */
export function findCornerWasteSpans(
	pts: Point[],
	corners: Point[],
	radiusMeters = ROUTE_CORNER_RADIUS_METERS,
	minPathMeters = ROUTE_CORNER_MIN_PATH_METERS,
	minPathToChord = ROUTE_CORNER_MIN_PATH_TO_CHORD
): LoopSpan[] {
	if (pts.length < 4 || corners.length === 0) return [];

	const prefix = new Array(pts.length).fill(0);
	for (let i = 1; i < pts.length; i++) {
		prefix[i] = prefix[i - 1] + distanceBetween(pts[i - 1], pts[i]);
	}

	const candidates: LoopSpan[] = [];

	for (const c of corners) {
		// Contiguous runs of path indices within radius of corner.
		let runStart = -1;
		const flush = (start: number, end: number) => {
			if (end - start < 3) return;
			const pathLen = prefix[end] - prefix[start];
			if (pathLen < minPathMeters) return;
			const chord = Math.max(distanceBetween(pts[start], pts[end]), 1);
			if (pathLen / chord < minPathToChord) return;
			// Must actually approach the corner (not a distant parallel road).
			let minToCorner = Infinity;
			for (let i = start; i <= end; i++) {
				minToCorner = Math.min(minToCorner, distanceBetween(pts[i], c));
			}
			if (minToCorner > radiusMeters * 0.5) return;
			const sev = spurSeverity(pathLen, chord);
			candidates.push({ m: start, j: end, severity: sev });
		};

		for (let i = 0; i < pts.length; i++) {
			const near = distanceBetween(pts[i], c) <= radiusMeters;
			if (near && runStart < 0) runStart = i;
			if (!near && runStart >= 0) {
				flush(runStart, i - 1);
				runStart = -1;
			}
		}
		if (runStart >= 0) flush(runStart, pts.length - 1);
	}

	candidates.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
	const spans: LoopSpan[] = [];
	const taken: Array<[number, number]> = [];
	for (const c of candidates) {
		if (taken.some(([lo, hi]) => !(c.j <= lo || c.m >= hi))) continue;
		spans.push(c);
		taken.push([c.m, c.j]);
	}
	return spans.slice().sort((a, b) => a.m - b.m);
}

async function collapseCornerWaste(
	pts: Point[],
	corners: Point[],
	route: SegmentRouter
): Promise<Point[]> {
	const spans = findCornerWasteSpans(pts, corners);
	if (spans.length === 0) return pts;
	const limited = spans
		.slice()
		.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))
		.slice(0, ROUTE_CLEAN_SPANS_PER_PASS);
	const { path, replaced } = await applyNetworkSpans(pts, limited, route);
	return replaced > 0 ? path : pts;
}

// Geometric cleanup only (chords). Useful for pure unit tests of detection.
export function cleanRoutedPath(points: Point[]): Point[] {
	if (points.length < 3) return points.slice();
	const noLoops = removeShortLoops(points);
	return removeHairpins(noLoops);
}

export type CleanRouteOptions = {
	maxBridges?: number;
	/** Sketch vertices — enables corner-neighborhood waste collapse. */
	corners?: Point[];
};

// Network-safe cleanup with a hard bridge budget. Detect reverse spurs,
// local detours, optional corner waste, and hairpins; re-route or drop.
export async function cleanRoutedPathOnNetwork(
	points: Point[],
	route: SegmentRouter = routeSegmentOnNetwork,
	maxBridgesOrOptions: number | CleanRouteOptions = ROUTE_CLEAN_MAX_BRIDGES
): Promise<Point[]> {
	if (points.length < 3) return points.slice();

	const options: CleanRouteOptions =
		typeof maxBridgesOrOptions === 'number'
			? { maxBridges: maxBridgesOrOptions }
			: maxBridgesOrOptions;
	const maxBridges = options.maxBridges ?? ROUTE_CLEAN_MAX_BRIDGES;

	const { route: budgeted } = withBridgeBudget(route, maxBridges);
	let pts = await collapseLoopsOnNetwork(points, budgeted);
	if (options.corners && options.corners.length > 0) {
		pts = await collapseCornerWaste(pts, options.corners, budgeted);
	}
	pts = await collapseHairpinsOnNetwork(pts, budgeted);

	return pts.length >= 2 ? pts : points.slice();
}
