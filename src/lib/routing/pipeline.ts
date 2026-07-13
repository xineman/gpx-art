import {
	ROUTE_ANCHOR_CHUNK_SIZE,
	ROUTE_ANCHOR_HARD_CAP,
	STRUCTURED_BEARING_RANGE_DEG
} from '$lib/constants/routing';
import { distanceBetween, initialBearingDegrees } from '$lib/geometry/distance';
import type { Point, Shape, ShapeType } from '$lib/types/sketch';
import { defaultRoutingOptions, type RoutingOptions } from './options';
import type { GetRouteOptions, RouteBearing, RouteResult } from './osrm';
import { getRoute, pencilRouteAnchors } from './osrm';
import { decodePolyline } from './polyline';
import { sampleTrace } from './sample';
import { simplifyRdp } from './rdp';
import { measureSketchGeometry } from './sketchGeometry';

export type { RoutingOptions };
export { measureSketchGeometry } from './sketchGeometry';

// One shape after TSP direction choice, ready for OSRM.
export type PreparedShapeRoute = {
	shape: Shape;
	/** Visit index in TSP order (0-based). */
	shapeIndex: number;
	/**
	 * Hard-via anchors for /route (after densify / RDP / cap).
	 * Same pipeline for pencil, line, polygon, and rectangle.
	 */
	points: Point[];
	/** Where the rider enters this shape (and, for closed shapes, exits). */
	entry: Point;
	/** Where the rider leaves this shape after routing. */
	exit: Point;
	/** Extra /route options for each chunk. */
	routeOptions?: GetRouteOptions;
};

export function isClosedShapeType(type: ShapeType): boolean {
	return type === 'polygon' || type === 'rectangle';
}

// Entry/exit for TSP transitions and inter-shape /route links.
// Closed shapes full-loop: exit equals the loop start (entry).
export function shapeEndpoints(
	shape: Shape,
	reversed: boolean
): { entry: Point; exit: Point; isClosed: boolean } {
	const pts = shape.points;
	if (pts.length === 0) {
		throw new Error('shapeEndpoints requires at least one point');
	}
	const first = pts[0];
	const last = pts[pts.length - 1];
	const isClosed = isClosedShapeType(shape.type);

	if (isClosed) {
		const start = reversed ? last : first;
		return { entry: start, exit: start, isClosed };
	}

	return {
		entry: reversed ? last : first,
		exit: reversed ? first : last,
		isClosed: false
	};
}

export function maxEdgeMeters(points: Point[]): number {
	if (points.length < 2) return 0;
	let max = 0;
	for (let i = 1; i < points.length; i++) {
		const d = distanceBetween(points[i - 1], points[i]);
		if (d > max) max = d;
	}
	return max;
}

// Build the open/closed vertex chain used for API choice and routing.
export function routingChain(shape: Shape, reversed: boolean): Point[] {
	const source = reversed ? [...shape.points].reverse() : shape.points;
	if (isClosedShapeType(shape.type) && source.length > 0) {
		return [...source, source[0]];
	}
	return source.slice();
}

// Whether a structured shape needs intermediate vias / per-edge handling.
// Kept for tests and callers that inspect edge length vs via-min.
export function needsStructuredEdgeVias(
	chain: Point[],
	minEdgeMeters = defaultRoutingOptions().structuredEdgeViaMinMeters
): boolean {
	return maxEdgeMeters(chain) >= minEdgeMeters;
}

// Densify a single edge for hard /route vias.
export function densifyStructuredVias(
	chain: Point[],
	spacingMeters = defaultRoutingOptions().structuredViaSpacingMeters,
	maxVias = defaultRoutingOptions().structuredMaxViasPerEdge
): Point[] {
	if (chain.length < 2) return chain.slice();
	if (maxVias < 2) {
		throw new Error('Structured max vias must be at least 2.');
	}

	let spacing = Math.max(spacingMeters, 1);
	let pts = sampleTrace(chain, spacing);

	if (pts.length > maxVias) {
		const perimeter = totalChainLength(chain);
		spacing = Math.max(spacing, perimeter / Math.max(maxVias - 1, 1));
		pts = sampleTrace(chain, spacing);
	}

	if (pts.length <= maxVias) return pts;
	return subsampleKeepEnds(pts, maxVias);
}

export function totalChainLength(points: Point[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		total += distanceBetween(points[i - 1], points[i]);
	}
	return total;
}

export function subsampleKeepEnds(points: Point[], maxPoints: number): Point[] {
	if (points.length <= maxPoints) return points.slice();
	if (maxPoints < 2) {
		throw new Error('subsampleKeepEnds requires maxPoints >= 2');
	}
	const out: Point[] = [];
	for (let i = 0; i < maxPoints; i++) {
		const idx = Math.round((i * (points.length - 1)) / (maxPoints - 1));
		out.push(points[idx]);
	}
	return out;
}

// Max distance from any path point to the sketch segment [a,b] (meters).
export function maxDeviationFromSegment(path: Point[], a: Point, b: Point): number {
	if (path.length === 0) return 0;
	let max = 0;
	for (const p of path) {
		const d = pointToSegmentDistance(p, a, b);
		if (d > max) max = d;
	}
	return max;
}

// Mean distance from path points to segment [a,b].
export function meanDeviationFromSegment(path: Point[], a: Point, b: Point): number {
	if (path.length === 0) return 0;
	let sum = 0;
	for (const p of path) sum += pointToSegmentDistance(p, a, b);
	return sum / path.length;
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
	const cosLat = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
	const mPerDegLat = 111_320;
	const mPerDegLng = 111_320 * cosLat;
	const ax = 0;
	const ay = 0;
	const bx = (b.lng - a.lng) * mPerDegLng;
	const by = (b.lat - a.lat) * mPerDegLat;
	const px = (p.lng - a.lng) * mPerDegLng;
	const py = (p.lat - a.lat) * mPerDegLat;
	const ab2 = bx * bx + by * by;
	if (ab2 < 1e-6) return Math.hypot(px - ax, py - ay);
	let t = ((px - ax) * bx + (py - ay) * by) / ab2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (ax + t * bx), py - (ay + t * by));
}

export function sketchBearings(
	points: Point[],
	rangeDeg = STRUCTURED_BEARING_RANGE_DEG
): Array<RouteBearing | null> {
	if (points.length < 2) return points.map(() => null);
	return points.map((_, i) => {
		const from = i < points.length - 1 ? points[i] : points[i - 1];
		const to = i < points.length - 1 ? points[i + 1] : points[i];
		if (from.lat === to.lat && from.lng === to.lng) return null;
		return { bearing: initialBearingDegrees(from, to), range: rangeDeg };
	});
}

export function routeOptionsForSegment(segment: Point[]): GetRouteOptions {
	if (segment.length <= 2) {
		return { continueStraight: true };
	}
	return {
		continueStraight: true,
		bearings: sketchBearings(segment)
	};
}

/**
 * Adaptive single-edge route (still used for focused tests / experiments).
 * Main shape routing no longer branches on this vs pencil.
 */
export async function routeAdaptiveEdge(
	a: Point,
	b: Point,
	routeFn: typeof getRoute = getRoute,
	options: RoutingOptions = defaultRoutingOptions()
): Promise<RouteResult> {
	const simple = await routeFn([a, b], { continueStraight: true });
	const simplePath = decodePolyline(simple.geometry);
	const simpleDev = maxDeviationFromSegment(simplePath, a, b);
	const simpleMean = meanDeviationFromSegment(simplePath, a, b);

	if (simpleDev <= options.structuredEdgeDeviationMeters) {
		return simple;
	}

	const edgeLen = distanceBetween(a, b);
	if (edgeLen < options.structuredEdgeViaMinMeters) {
		return simple;
	}

	const vias = densifyStructuredVias(
		[a, b],
		options.structuredViaSpacingMeters,
		options.structuredMaxViasPerEdge
	);
	if (vias.length <= 2) {
		return simple;
	}

	try {
		const dense = await routeFn(vias, routeOptionsForSegment(vias));
		const densePath = decodePolyline(dense.geometry);
		const denseDev = maxDeviationFromSegment(densePath, a, b);
		const denseMean = meanDeviationFromSegment(densePath, a, b);

		const betterFit = denseMean < simpleMean * 0.85 || denseDev < simpleDev * 0.85;
		const lengthOk = dense.distance <= simple.distance * options.structuredDenseLengthRatio;
		if (betterFit && lengthOk) {
			return dense;
		}
	} catch {
		// Fall back to simple on densified failure.
	}

	return simple;
}

/** Point inset `meters` from `from` toward `to` (or midpoint if edge is short). */
export function insetAlongEdge(from: Point, to: Point, meters: number): Point {
	const d = distanceBetween(from, to);
	if (d <= meters * 2 || d < 1) {
		return {
			lat: (from.lat + to.lat) / 2,
			lng: (from.lng + to.lng) / 2
		};
	}
	const t = meters / d;
	return {
		lat: from.lat + (to.lat - from.lat) * t,
		lng: from.lng + (to.lng - from.lng) * t
	};
}

/**
 * Build soft-corner edge pairs from a corner chain.
 * Each edge runs inset from start corner → inset before end corner so long
 * legs never hard-end on the geometric vertex.
 */
export function softCornerEdgePairs(
	corners: Point[],
	insetMeters = defaultRoutingOptions().structuredCornerInsetMeters
): Array<{ a: Point; b: Point }> {
	const pairs: Array<{ a: Point; b: Point }> = [];
	for (let i = 1; i < corners.length; i++) {
		const c0 = corners[i - 1];
		const c1 = corners[i];
		if (c0.lat === c1.lat && c0.lng === c1.lng) continue;
		const a = insetAlongEdge(c0, c1, insetMeters);
		const b = insetAlongEdge(c1, c0, insetMeters);
		pairs.push({ a, b });
	}
	return pairs;
}

function samePoint(a: Point, b: Point): boolean {
	return a.lat === b.lat && a.lng === b.lng;
}

/**
 * Soft-corner polyline: stop short of geometric vertices, start after them.
 * Used as a preprocess before densify so corner softness is not a separate
 * OSRM strategy from freehand.
 */
export function softCornerPolyline(
	corners: Point[],
	insetMeters: number
): Point[] {
	if (insetMeters <= 0 || corners.length < 3) return corners.slice();
	const pairs = softCornerEdgePairs(corners, insetMeters);
	if (pairs.length === 0) return corners.slice();

	const out: Point[] = [];
	for (const { a, b } of pairs) {
		if (out.length === 0 || !samePoint(out[out.length - 1], a)) {
			out.push(a);
		}
		if (!samePoint(out[out.length - 1], b)) {
			out.push(b);
		}
	}
	return out.length >= 2 ? out : corners.slice();
}

/**
 * Soft corners only on sparse geometric sketches (few long edges).
 * Dense freehand has many short edges — inset would collapse the stroke.
 */
export function shouldApplySoftCorners(
	chain: Point[],
	insetMeters: number
): boolean {
	if (insetMeters <= 0) return false;
	const profile = measureSketchGeometry(chain);
	if (profile.vertexCount < 3) return false;
	// Freehand-like density: skip.
	if (profile.edgeCount >= 8 && profile.medianEdgeM < insetMeters) return false;
	// Need at least one edge long enough for a meaningful inset.
	if (profile.maxEdgeM < insetMeters * 2) return false;
	// Many short-ish edges (subdivided freehand): skip.
	if (profile.edgeCount > 24) return false;
	return true;
}

/**
 * Via budget scales with path length so multi-km polylines keep pin density.
 * Floor at pencilMaxVias (short freehand); ceiling at ROUTE_ANCHOR_HARD_CAP.
 */
export function anchorBudgetForLength(
	totalLengthM: number,
	options: RoutingOptions
): number {
	const spacing = Math.max(options.pencilSampleSpacingMeters, 1);
	const ideal = Math.ceil(totalLengthM / spacing) + 1;
	return Math.min(
		ROUTE_ANCHOR_HARD_CAP,
		Math.max(options.pencilMaxVias, ideal)
	);
}

/**
 * After RDP, re-pin long edges. Straight geometric chords lose densified
 * midpoints under RDP (collinear), which would leave only endpoints — the
 * old structured path densified without that collapse.
 */
export function ensureLongEdgeVias(
	points: Point[],
	spacingMeters: number,
	viaMinMeters: number,
	maxVias: number
): Point[] {
	if (points.length < 2) return points.slice();

	const out: Point[] = [points[0]];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const d = distanceBetween(a, b);
		if (d >= viaMinMeters) {
			const densified = sampleTrace([a, b], Math.max(spacingMeters, 1));
			// First point is `a` (already in out).
			for (let j = 1; j < densified.length; j++) {
				out.push(densified[j]);
			}
		} else {
			out.push(b);
		}
	}

	if (out.length <= maxVias) return out;
	return subsampleKeepEnds(out, maxVias);
}

/**
 * Densify → mild RDP → freehand via sparsify → re-pin long edges.
 * Long geometric chords stay pinned even though RDP drops collinear samples.
 * Same pipeline for pencil strokes and sparse polylines.
 */
export function prepareSketchAnchors(
	chain: Point[],
	options: RoutingOptions = defaultRoutingOptions()
): Point[] {
	if (chain.length < 2) return chain.slice();

	const spacing = options.pencilSampleSpacingMeters;
	let pts = sampleTrace(chain, spacing);
	const rdpped = simplifyRdp(pts, options.rdpTolerancePencil);
	pts = rdpped.length >= 2 ? rdpped : chain;

	const total = totalChainLength(chain);
	const maxVias = anchorBudgetForLength(total, options);

	// Collapse freehand micro-detail to a short hard-via list.
	pts = pencilRouteAnchors(pts, options.pencilRouteRdpTolerance, maxVias);

	// RDP removes collinear densify points on straight edges — put them back
	// so multi-km lines/rects still force the route toward the sketch chord.
	return ensureLongEdgeVias(
		pts,
		Math.max(spacing, options.structuredViaSpacingMeters),
		options.structuredEdgeViaMinMeters,
		maxVias
	);
}

/** Split anchors into overlapping chunks for OSRM URL size limits. */
export function chunkRouteAnchors(
	points: Point[],
	chunkSize = ROUTE_ANCHOR_CHUNK_SIZE
): Point[][] {
	if (points.length < 2) return [];
	if (chunkSize < 2) {
		throw new Error('Route anchor chunk size must be at least 2.');
	}
	if (points.length <= chunkSize) return [points.slice()];

	const chunks: Point[][] = [];
	let i = 0;
	while (i < points.length - 1) {
		const end = Math.min(i + chunkSize - 1, points.length - 1);
		chunks.push(points.slice(i, end + 1));
		if (end >= points.length - 1) break;
		i = end; // overlap on shared via
	}
	return chunks;
}

// Route prepared anchors: one or more hard-via /route calls (chunked).
export async function routePreparedStructured(
	prepared: PreparedShapeRoute,
	_options: RoutingOptions = defaultRoutingOptions()
): Promise<{ geometries: string[]; distance: number; duration: number }> {
	if (prepared.points.length < 2) {
		return { geometries: [], distance: 0, duration: 0 };
	}

	const routeOpts = prepared.routeOptions ?? { continueStraight: true };
	const chunks = chunkRouteAnchors(prepared.points);
	const results = await Promise.all(chunks.map((chunk) => getRoute(chunk, routeOpts)));

	return {
		geometries: results.map((r) => r.geometry).filter((g) => g.length > 0),
		distance: results.reduce((s, r) => s + r.distance, 0),
		duration: results.reduce((s, r) => s + r.duration, 0)
	};
}

/**
 * Preprocess one shape for OSRM — same flow for every tool:
 * chain → optional soft corners → densify / RDP / anchors → hard-via /route.
 */
export function prepareShapeRoute(
	shape: Shape,
	reversed: boolean,
	shapeIndex = 0,
	options: RoutingOptions = defaultRoutingOptions()
): PreparedShapeRoute {
	const { entry, exit } = shapeEndpoints(shape, reversed);
	let chain = routingChain(shape, reversed);

	if (chain.length < 2) {
		return {
			shape,
			shapeIndex,
			points: chain,
			entry,
			exit
		};
	}

	if (shouldApplySoftCorners(chain, options.structuredCornerInsetMeters)) {
		chain = softCornerPolyline(chain, options.structuredCornerInsetMeters);
	}

	const points = prepareSketchAnchors(chain, options);
	return {
		shape,
		shapeIndex,
		points,
		entry,
		exit,
		routeOptions: { continueStraight: true }
	};
}
