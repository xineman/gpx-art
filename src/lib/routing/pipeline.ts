import {
	ROUTE_ANCHOR_CHUNK_SIZE,
	ROUTE_ANCHOR_HARD_CAP
} from '$lib/constants/routing';
import { distanceBetween, turnCosine } from '$lib/geometry/distance';
import type { Point, Shape, ShapeType } from '$lib/types/sketch';
import { defaultRoutingOptions, type RoutingOptions } from './options';
import type { GetRouteOptions } from './osrm';
import { getRoute, pencilRouteAnchors } from './osrm';
import { sampleTrace } from './sample';
import { simplifyRdp } from './rdp';

export type { RoutingOptions };

/**
 * Softenable corner: turn sharper than this cosine (cos 60° ≈ 0.5).
 * 1 = straight, 0 = 90°, -1 = U-turn.
 */
export const SOFT_CORNER_MAX_TURN_COSINE = 0.5;

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

// Build the open/closed vertex chain used for routing.
export function routingChain(shape: Shape, reversed: boolean): Point[] {
	const source = reversed ? [...shape.points].reverse() : shape.points;
	if (isClosedShapeType(shape.type) && source.length > 0) {
		return [...source, source[0]];
	}
	return source.slice();
}

function totalChainLength(points: Point[]): number {
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

function samePoint(a: Point, b: Point): boolean {
	return a.lat === b.lat && a.lng === b.lng;
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

function softCornerEdgePairs(
	corners: Point[],
	insetMeters: number
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

/**
 * Soft-corner polyline: stop short of geometric vertices, start after them.
 * Preprocess before densify (not a separate OSRM strategy).
 */
export function softCornerPolyline(corners: Point[], insetMeters: number): Point[] {
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
 * Find major corners on any sketch polyline (pencil or geometric tools).
 *
 * Dense freehand is RDP-simplified first so a pencil-drawn rectangle becomes
 * a few long legs + sharp corners; gentle freehand wiggles do not count.
 */
export function extractSoftCornerSkeleton(
	chain: Point[],
	insetMeters: number,
	maxTurnCosine = SOFT_CORNER_MAX_TURN_COSINE
): Point[] | null {
	if (insetMeters <= 0 || chain.length < 3) return null;

	const closed = chain.length >= 3 && samePoint(chain[0], chain[chain.length - 1]);
	const rdpTol = Math.max(20, Math.min(insetMeters * 0.35, 80));
	let simplified = simplifyRdp(chain, rdpTol);
	if (simplified.length < 2) return null;

	if (closed && !samePoint(simplified[0], simplified[simplified.length - 1])) {
		simplified = [...simplified, simplified[0]];
	}

	const uniqueN = closed
		? simplified.length - (samePoint(simplified[0], simplified[simplified.length - 1]) ? 1 : 0)
		: simplified.length;
	if (uniqueN < 3) return null;

	const minLeg = insetMeters * 2;
	const skeleton: Point[] = [];
	let softenableCorners = 0;

	for (let i = 0; i < uniqueN; i++) {
		const mid = simplified[i];
		const isOpenEnd = !closed && (i === 0 || i === uniqueN - 1);
		if (isOpenEnd) {
			skeleton.push(mid);
			continue;
		}

		const prev = simplified[(i - 1 + uniqueN) % uniqueN];
		const next = simplified[(i + 1) % uniqueN];
		const cos = turnCosine(prev, mid, next);
		if (cos >= maxTurnCosine) continue;

		skeleton.push(mid);
		const legIn = distanceBetween(prev, mid);
		const legOut = distanceBetween(mid, next);
		if (legIn >= minLeg && legOut >= minLeg) softenableCorners++;
	}

	if (closed) {
		if (skeleton.length < 3) return null;
		if (!samePoint(skeleton[0], skeleton[skeleton.length - 1])) {
			skeleton.push(skeleton[0]);
		}
	} else if (skeleton.length < 3) {
		return null;
	}

	if (softenableCorners < 1) return null;
	if (maxEdgeMeters(skeleton) < minLeg) return null;

	return skeleton;
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
	return Math.min(ROUTE_ANCHOR_HARD_CAP, Math.max(options.pencilMaxVias, ideal));
}

/**
 * After RDP, re-pin long edges. Straight geometric chords lose densified
 * midpoints under RDP (collinear); put them back so multi-km lines stay pinned.
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

	pts = pencilRouteAnchors(pts, options.pencilRouteRdpTolerance, maxVias);

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
		i = end;
	}
	return chunks;
}

/** Route prepared anchors: one or more hard-via /route calls (chunked). */
export async function routePreparedShape(
	prepared: PreparedShapeRoute
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

	const inset = options.structuredCornerInsetMeters;
	const cornerSkeleton = extractSoftCornerSkeleton(chain, inset);
	if (cornerSkeleton) {
		chain = softCornerPolyline(cornerSkeleton, inset);
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
