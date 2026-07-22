import type { Position } from 'geojson';
import {
	MAX_VIAS,
	MIN_VIAS,
	VIA_SAMPLE_SPACING_M,
	VIA_SIMPLIFY_TOLERANCE_M
} from '$lib/config/routing';
import { distanceBetween } from '$lib/geometry/distance';
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

/**
 * Add intermediate vias to long segments while retaining every input vertex.
 * For closed paths, the closing segment is included and the repeated start
 * counts toward `maxVias`.
 */
export function densifySegments(
	points: Position[],
	closed: boolean,
	maxVias: number,
	spacingM: number
): Position[] {
	if (points.length < 2 || maxVias < 2) return [...points].slice(0, maxVias);

	const segmentCount = closed ? points.length : points.length - 1;
	const baseViaCount = points.length + (closed ? 1 : 0);
	if (spacingM <= 0 || baseViaCount >= maxVias) {
		return closed ? [...points, points[0]!] : [...points];
	}

	const lengths = Array.from({ length: segmentCount }, (_, index) => {
		const nextIndex = (index + 1) % points.length;
		return distanceBetween(points[index]!, points[nextIndex]!);
	});
	const divisions = lengths.map(() => 1);
	let remaining = maxVias - baseViaCount;

	while (remaining > 0) {
		let longestIndex = -1;
		let longestInterval = spacingM;

		for (let index = 0; index < segmentCount; index++) {
			const interval = lengths[index]! / divisions[index]!;
			if (interval > longestInterval) {
				longestInterval = interval;
				longestIndex = index;
			}
		}

		if (longestIndex < 0) break;
		divisions[longestIndex]! += 1;
		remaining -= 1;
	}

	const out: Position[] = [points[0]!];
	for (let index = 0; index < segmentCount; index++) {
		const start = points[index]!;
		const end = points[(index + 1) % points.length]!;
		const divisionCount = divisions[index]!;

		for (let step = 1; step <= divisionCount; step++) {
			if (step === divisionCount) {
				out.push(end);
				continue;
			}

			const fraction = step / divisionCount;
			out.push([
				start[0]! + (end[0]! - start[0]!) * fraction,
				start[1]! + (end[1]! - start[1]!) * fraction
			]);
		}
	}

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
 * Build map-matching trace points from a guide path.
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

	points = simplifyRdp(points, toleranceM);
	points = dedupeConsecutive(points);

	const pointBudget = guide.closed ? maxVias - 1 : maxVias;
	if (pointBudget < MIN_VIAS) {
		return { ok: false, error: 'Need a longer sketch to route.' };
	}
	if (points.length > pointBudget) points = strideToMax(points, pointBudget);

	points = densifySegments(points, guide.closed, maxVias, sampleSpacingM);
	// Closed path may legitimately start==end as two list entries to complete the trace.
	// Only fail if fewer than 2 unique positions.
	const uniqueEnough =
		points.length >= MIN_VIAS &&
		(points.length > 2 || points[0]![0] !== points[1]![0] || points[0]![1] !== points[1]![1]);

	if (!uniqueEnough) {
		return { ok: false, error: 'Need a longer sketch to route.' };
	}

	return { ok: true, vias: points };
}
