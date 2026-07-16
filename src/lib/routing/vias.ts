import type { Position } from 'geojson';
import {
	MAX_VIAS,
	MIN_VIAS,
	VIA_SAMPLE_SPACING_M,
	VIA_SIMPLIFY_TOLERANCE_M
} from '$lib/config/routing';
import { distanceBetween, pathLength } from '$lib/geometry/distance';
import type { GuidePath } from './types';

export type ViasResult = { ok: true; vias: Position[] } | { ok: false; error: string };

/**
 * Perpendicular distance from point P to segment AB, in meters.
 * Uses a local equirectangular approximation around the segment midpoint.
 */
function perpendicularDistanceM(p: Position, a: Position, b: Position): number {
	const [lngP, latP] = p;
	const [lngA, latA] = a;
	const [lngB, latB] = b;
	const midLat = (((latA + latB) / 2) * Math.PI) / 180;
	const cos = Math.cos(midLat);
	// meters per degree (approx)
	const mx = 111_320 * cos;
	const my = 110_540;
	const ax = 0;
	const ay = 0;
	const bx = (lngB - lngA) * mx;
	const by = (latB - latA) * my;
	const px = (lngP - lngA) * mx;
	const py = (latP - latA) * my;
	const len2 = bx * bx + by * by;
	if (len2 < 1e-6) return Math.hypot(px - ax, py - ay);
	let t = (px * bx + py * by) / len2;
	t = Math.max(0, Math.min(1, t));
	const qx = ax + t * bx;
	const qy = ay + t * by;
	return Math.hypot(px - qx, py - qy);
}

/** Douglas–Peucker simplify using meter tolerance. */
export function simplifyRdp(points: Position[], toleranceM: number): Position[] {
	if (points.length <= 2) return [...points];

	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;

	const stack: Array<[number, number]> = [[0, points.length - 1]];

	while (stack.length > 0) {
		const [start, end] = stack.pop()!;
		const a = points[start]!;
		const b = points[end]!;
		let maxDist = 0;
		let maxIdx = -1;
		for (let i = start + 1; i < end; i++) {
			const d = perpendicularDistanceM(points[i]!, a, b);
			if (d > maxDist) {
				maxDist = d;
				maxIdx = i;
			}
		}
		if (maxIdx >= 0 && maxDist > toleranceM) {
			keep[maxIdx] = 1;
			stack.push([start, maxIdx], [maxIdx, end]);
		}
	}

	const out: Position[] = [];
	for (let i = 0; i < points.length; i++) {
		if (keep[i]) out.push(points[i]!);
	}
	return out;
}

/** Uniform samples along the path every `spacingM` meters (always keeps ends). */
export function sampleAlongPath(points: Position[], spacingM: number): Position[] {
	if (points.length < 2) return [...points];
	if (spacingM <= 0) return [...points];

	const out: Position[] = [points[0]!];
	let acc = 0;
	let nextAt = spacingM;

	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1]!;
		const curr = points[i]!;
		const seg = distanceBetween(prev, curr);
		if (seg === 0) continue;

		let traveled = 0;
		while (acc + (seg - traveled) >= nextAt) {
			const need = nextAt - acc;
			const t = (traveled + need) / seg;
			const lng = prev[0]! + (curr[0]! - prev[0]!) * t;
			const lat = prev[1]! + (curr[1]! - prev[1]!) * t;
			out.push([lng, lat]);
			traveled += need;
			acc = nextAt;
			nextAt += spacingM;
		}
		acc += seg - traveled;
	}

	const last = points[points.length - 1]!;
	const tail = out[out.length - 1]!;
	if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
	return out;
}

/** Evenly stride an array down to at most `max` points (keeps first and last). */
export function strideToMax(points: Position[], max: number): Position[] {
	if (points.length <= max) return [...points];
	if (max < 2) return [points[0]!, points[points.length - 1]!];

	const out: Position[] = [points[0]!];
	const inner = max - 2;
	for (let i = 1; i <= inner; i++) {
		const idx = Math.round((i * (points.length - 1)) / (max - 1));
		const p = points[idx]!;
		const prev = out[out.length - 1]!;
		if (p[0] !== prev[0] || p[1] !== prev[1]) out.push(p);
	}
	const last = points[points.length - 1]!;
	const tail = out[out.length - 1]!;
	if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
	return out;
}

function dedupeConsecutive(points: Position[]): Position[] {
	if (points.length === 0) return [];
	const out: Position[] = [points[0]!];
	for (let i = 1; i < points.length; i++) {
		const p = points[i]!;
		const prev = out[out.length - 1]!;
		if (p[0] !== prev[0] || p[1] !== prev[1]) out.push(p);
	}
	return out;
}

/**
 * Build OSRM via points from a guide path.
 * Closed guides get the start re-appended so the route returns to the origin.
 */
export function guideToVias(
	guide: GuidePath,
	options: {
		maxVias?: number;
		toleranceM?: number;
		sampleSpacingM?: number;
	} = {}
): ViasResult {
	const maxVias = options.maxVias ?? MAX_VIAS;
	const toleranceM = options.toleranceM ?? VIA_SIMPLIFY_TOLERANCE_M;
	const sampleSpacingM = options.sampleSpacingM ?? VIA_SAMPLE_SPACING_M;

	let points = dedupeConsecutive(guide.points);
	if (points.length < MIN_VIAS) {
		return { ok: false, error: 'Need a longer sketch to route.' };
	}

	// Dense freehand: sample first so RDP works on a regular chain.
	const lengthM = pathLength(points);
	if (points.length > maxVias * 2 || lengthM > sampleSpacingM * maxVias) {
		points = sampleAlongPath(points, sampleSpacingM);
	}

	points = simplifyRdp(points, toleranceM);
	points = dedupeConsecutive(points);

	if (points.length > maxVias) {
		// Leave room to re-append close for loops.
		const budget = guide.closed ? Math.max(MIN_VIAS, maxVias - 1) : maxVias;
		points = strideToMax(points, budget);
	}

	if (guide.closed && points.length >= 2) {
		const first = points[0]!;
		const last = points[points.length - 1]!;
		if (first[0] !== last[0] || first[1] !== last[1]) {
			if (points.length < maxVias) {
				points = [...points, first];
			}
		}
	}

	points = dedupeConsecutive(points);
	// Closed path may legitimately start==end as two list entries — OSRM needs them.
	// Only fail if fewer than 2 unique positions.
	const uniqueEnough =
		points.length >= MIN_VIAS &&
		(points.length > 2 || points[0]![0] !== points[1]![0] || points[0]![1] !== points[1]![1]);

	if (!uniqueEnough) {
		return { ok: false, error: 'Need a longer sketch to route.' };
	}

	return { ok: true, vias: points };
}
