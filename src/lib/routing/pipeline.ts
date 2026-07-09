import { STRUCTURED_BEARING_RANGE_DEG } from '$lib/constants/routing';
import { distanceBetween, initialBearingDegrees } from '$lib/geometry/distance';
import type { Point, Shape, ShapeType } from '$lib/types/sketch';
import { usesMatchApi, type RouteCallKind } from './batchPlan';
import { defaultRoutingOptions, type RoutingOptions } from './options';
import type { GetRouteOptions, RouteBearing, RouteResult } from './osrm';
import { getRoute } from './osrm';
import { decodePolyline } from './polyline';
import { sampleTrace } from './sample';
import { simplifyRdp } from './rdp';

export type { RouteCallKind };
export type { RoutingOptions };

// One shape after TSP direction choice, ready for an OSRM call.
export type PreparedShapeRoute = {
	shape: Shape;
	/** Visit index in TSP order (0-based). */
	shapeIndex: number;
	/**
	 * Coordinates for debug / fallback. For multi-edge structured this is the
	 * corner chain (or densified flatten); actual OSRM calls may use
	 * edgeCorners for adaptive per-edge routing.
	 */
	points: Point[];
	callKind: RouteCallKind;
	/** Where the rider enters this shape (and, for closed shapes, exits). */
	entry: Point;
	/** Where the rider leaves this shape after routing. */
	exit: Point;
	/** Extra /route options for a single-call shape. */
	routeOptions?: GetRouteOptions;
	/**
	 * Corner chain including close for closed shapes. When set with length≥2,
	 * routePreparedStructured routes each edge adaptively (parallel).
	 */
	edgeCorners?: Point[];
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
 * Adaptive single-edge route:
 *  1. /route corner→corner (fast, no forced mid-edge snaps)
 *  2. If the path wanders far from the sketch edge, try densified vias
 *  3. Keep densified only when it tracks the edge better without exploding length
 *
 * Avoids the failure mode where vias land on river/park and force worse detours
 * than a simple A→B road route.
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

	// Edge is short enough that densify wouldn't add points.
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

		// Accept densified only if it hugs the edge better and length is sane.
		const betterFit =
			denseMean < simpleMean * 0.85 || denseDev < simpleDev * 0.85;
		const lengthOk = dense.distance <= simple.distance * options.detourRatio;
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

// Route a prepared structured shape: adaptive per-edge with soft corners,
// or single /route for short shapes.
export async function routePreparedStructured(
	prepared: PreparedShapeRoute,
	options: RoutingOptions = defaultRoutingOptions()
): Promise<{ geometries: string[]; distance: number; duration: number }> {
	if (prepared.edgeCorners && prepared.edgeCorners.length >= 2) {
		const corners = prepared.edgeCorners;
		const pairs = softCornerEdgePairs(corners, options.structuredCornerInsetMeters);
		// Route each soft edge + corner bridges between consecutive soft ends.
		const edgeResults = await Promise.all(
			pairs.map(({ a, b }) => routeAdaptiveEdge(a, b, getRoute, options))
		);

		// Bridge soft end of edge i to soft start of edge i+1 (rounded corner).
		const isClosed =
			corners.length >= 3 &&
			corners[0].lat === corners[corners.length - 1].lat &&
			corners[0].lng === corners[corners.length - 1].lng;
		const bridgeJobs: Array<Promise<RouteResult>> = [];
		const bridgeCount = isClosed ? pairs.length : Math.max(0, pairs.length - 1);
		for (let i = 0; i < bridgeCount; i++) {
			const from = pairs[i].b;
			const to = pairs[(i + 1) % pairs.length].a;
			if (distanceBetween(from, to) <= 2) {
				// Still push a resolved empty so interleave indices stay aligned.
				bridgeJobs.push(
					Promise.resolve({ geometry: '', distance: 0, duration: 0 } satisfies RouteResult)
				);
				continue;
			}
			bridgeJobs.push(getRoute([from, to], { continueStraight: true }));
		}
		const bridges = await Promise.all(bridgeJobs);

		// Interleave: edge0, bridge0, edge1, bridge1, ...
		const geometries: string[] = [];
		let distance = 0;
		let duration = 0;
		for (let i = 0; i < edgeResults.length; i++) {
			geometries.push(edgeResults[i].geometry);
			distance += edgeResults[i].distance;
			duration += edgeResults[i].duration;
			if (i < bridges.length) {
				geometries.push(bridges[i].geometry);
				distance += bridges[i].distance;
				duration += bridges[i].duration;
			}
		}
		return {
			geometries: geometries.filter((g) => g.length > 0),
			distance,
			duration
		};
	}

	const routed = await getRoute(
		prepared.points,
		prepared.routeOptions ?? { continueStraight: true }
	);
	return {
		geometries: [routed.geometry],
		distance: routed.distance,
		duration: routed.duration
	};
}

// Preprocess one shape for OSRM.
export function prepareShapeRoute(
	shape: Shape,
	reversed: boolean,
	shapeIndex = 0,
	options: RoutingOptions = defaultRoutingOptions()
): PreparedShapeRoute {
	const { entry, exit } = shapeEndpoints(shape, reversed);
	const chain = routingChain(shape, reversed);

	if (chain.length < 2) {
		return {
			shape,
			shapeIndex,
			points: chain,
			callKind: 'route',
			entry,
			exit
		};
	}

	// Pencil: densify + mild RDP (sketch length / rare /match escalate).
	// Live path is getMatchedRoute → sparse /route on MATCH_FALLBACK_* anchors.
	if (usesMatchApi(shape.type)) {
		let pts = sampleTrace(chain, options.matchSampleSpacingMeters);
		const rdpped = simplifyRdp(pts, options.rdpTolerancePencil);
		pts = rdpped.length >= 2 ? rdpped : chain;
		return {
			shape,
			shapeIndex,
			points: pts,
			callKind: 'match',
			entry,
			exit
		};
	}

	// Structured short: single corner /route.
	if (!needsStructuredEdgeVias(chain, options.structuredEdgeViaMinMeters)) {
		return {
			shape,
			shapeIndex,
			points: chain,
			callKind: 'route',
			entry,
			exit,
			routeOptions: chain.length > 2 ? { continueStraight: true } : undefined
		};
	}

	// Structured long: adaptive per-edge (corners list drives routing).
	return {
		shape,
		shapeIndex,
		points: chain,
		callKind: 'route',
		entry,
		exit,
		edgeCorners: chain
	};
}
