import type { Position } from 'geojson';
import { MAX_VIAS, VIA_SAMPLE_SPACING_M, VIA_SIMPLIFY_TOLERANCE_M } from '../config';
import { distanceBetween } from '#lib/geometry/distance.js';
import { samePosition } from '#lib/geometry/position.js';
import type { GuideWalk } from './types';

export type WalkViasResult = { ok: true; vias: Position[][] } | { ok: false; error: string };

export type WalkViasOptions = {
	/** Via cap shared by every walk: they are joined into one map-matching request. */
	maxVias?: number;
	/** Douglas–Peucker epsilon in meters; deviations within it are not worth a via. */
	toleranceM?: number;
	/** Preferred maximum interval between vias; spare budget splits longer intervals. */
	sampleSpacingM?: number;
};

/** Stretch of a walk between two kept points, with its most deviating interior point. */
type Span = {
	walk: number;
	start: number;
	end: number;
	split: number;
	deviationM: number;
};

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

function farthestInterior(points: Position[], start: number, end: number) {
	let split = start + 1;
	let deviationM = -1;
	for (let index = start + 1; index < end; index++) {
		const distance = perpendicularDistanceM(points[index]!, points[start]!, points[end]!);
		if (distance > deviationM) {
			split = index;
			deviationM = distance;
		}
	}
	return { split, deviationM };
}

/**
 * Split intervals longer than the sample spacing, longest first, until the budget runs out.
 * Every input point is kept.
 */
function densify(lines: Position[][], budget: number, spacingM: number): Position[][] {
	const lengths = lines.map((line) =>
		line.slice(1).map((end, index) => distanceBetween(line[index]!, end))
	);
	const divisions = lengths.map((line) => line.map(() => 1));

	for (let remaining = budget; remaining > 0; remaining--) {
		let longest: [number, number] | undefined;
		let longestInterval = spacingM;
		for (const [line, intervals] of lengths.entries()) {
			for (const [index, lengthM] of intervals.entries()) {
				const interval = lengthM / divisions[line]![index]!;
				if (interval > longestInterval) {
					longest = [line, index];
					longestInterval = interval;
				}
			}
		}
		if (!longest) break;
		divisions[longest[0]]![longest[1]]! += 1;
	}

	return lines.map((line, lineIndex) => {
		const out: Position[] = [line[0]!];
		for (const [index, divisionCount] of divisions[lineIndex]!.entries()) {
			const start = line[index]!;
			const end = line[index + 1]!;
			for (let step = 1; step < divisionCount; step++) {
				const fraction = step / divisionCount;
				out.push([
					start[0]! + (end[0]! - start[0]!) * fraction,
					start[1]! + (end[1]! - start[1]!) * fraction
				]);
			}
			out.push(end);
		}
		return out;
	});
}

/**
 * Turn component walks into map-matching vias under one shared budget. Mandatory points are always
 * kept, and a stretch that returns to its starting point keeps its farthest point so the loop
 * survives. The rest is Douglas–Peucker simplified across all walks at once, most deviating point
 * first, so the budget goes wherever the drawing bends most; spare budget then densifies long
 * intervals.
 */
export function allocateWalkVias(
	walks: GuideWalk[],
	options: WalkViasOptions = {}
): WalkViasResult {
	const maxVias = options.maxVias ?? MAX_VIAS;
	const toleranceM = options.toleranceM ?? VIA_SIMPLIFY_TOLERANCE_M;
	const sampleSpacingM = options.sampleSpacingM ?? VIA_SAMPLE_SPACING_M;

	const kept = walks.map(({ points }) => new Uint8Array(points.length));
	const spans: Span[] = [];
	let count = 0;

	const keep = (walk: number, index: number) => {
		kept[walk]![index] = 1;
		count += 1;
	};
	const addSpan = (walk: number, start: number, end: number) => {
		if (end - start < 2) return;
		const points = walks[walk]!.points;
		const span = { walk, start, end, ...farthestInterior(points, start, end) };
		if (samePosition(points[start]!, points[end]!)) splitSpan(span);
		else spans.push(span);
	};
	const splitSpan = ({ walk, start, end, split }: Span) => {
		keep(walk, split);
		addSpan(walk, start, split);
		addSpan(walk, split, end);
	};

	for (const [walk, { mandatory }] of walks.entries()) {
		for (const [order, index] of mandatory.entries()) {
			keep(walk, index);
			if (order > 0) addSpan(walk, mandatory[order - 1]!, index);
		}
	}
	if (count > maxVias) {
		return {
			ok: false,
			error: `Too many shapes and junctions to route at once (max ${maxVias} waypoints).`
		};
	}

	while (count < maxVias) {
		let best = -1;
		for (const [index, span] of spans.entries()) {
			if (span.deviationM > toleranceM && (best < 0 || span.deviationM > spans[best]!.deviationM)) {
				best = index;
			}
		}
		if (best < 0) break;
		splitSpan(spans.splice(best, 1)[0]!);
	}

	const lines = walks.map(({ points }, walk) => points.filter((_, index) => kept[walk]![index]));
	return { ok: true, vias: densify(lines, maxVias - count, sampleSpacingM) };
}
