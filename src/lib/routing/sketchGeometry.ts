import { distanceBetween } from '$lib/geometry/distance';
import type { Point } from '$lib/types/sketch';

/**
 * Sketch polyline metrics (edge lengths, density). Used for soft-corner
 * eligibility and diagnostics — not for branching into separate OSRM strategies.
 */
export type SketchGeometryProfile = {
	/** Unique vertices (closed chains do not double-count the repeated start). */
	vertexCount: number;
	edgeCount: number;
	totalLengthM: number;
	maxEdgeM: number;
	medianEdgeM: number;
	meanEdgeM: number;
	/** True when first and last points coincide (closed ring chain). */
	isClosedChain: boolean;
};

function samePoint(a: Point, b: Point): boolean {
	return a.lat === b.lat && a.lng === b.lng;
}

function edgeLengthsMeters(chain: Point[]): number[] {
	const lengths: number[] = [];
	for (let i = 1; i < chain.length; i++) {
		const a = chain[i - 1];
		const b = chain[i];
		if (samePoint(a, b)) continue;
		lengths.push(distanceBetween(a, b));
	}
	return lengths;
}

function medianOf(sorted: number[]): number {
	if (sorted.length === 0) return 0;
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[mid];
	return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Measure a routing chain (open path or closed with repeated first point). */
export function measureSketchGeometry(chain: Point[]): SketchGeometryProfile {
	const isClosedChain = chain.length >= 3 && samePoint(chain[0], chain[chain.length - 1]);
	const vertexCount = isClosedChain ? chain.length - 1 : chain.length;
	const edges = edgeLengthsMeters(chain);

	if (edges.length === 0) {
		return {
			vertexCount,
			edgeCount: 0,
			totalLengthM: 0,
			maxEdgeM: 0,
			medianEdgeM: 0,
			meanEdgeM: 0,
			isClosedChain
		};
	}

	const totalLengthM = edges.reduce((s, d) => s + d, 0);
	const maxEdgeM = Math.max(...edges);
	const sorted = [...edges].sort((a, b) => a - b);

	return {
		vertexCount,
		edgeCount: edges.length,
		totalLengthM,
		maxEdgeM,
		medianEdgeM: medianOf(sorted),
		meanEdgeM: totalLengthM / edges.length,
		isClosedChain
	};
}
