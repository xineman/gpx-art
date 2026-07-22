import type { Position } from 'geojson';
import type { PreparedRouteShape } from './types';

export type ShapeTraversalCandidate = {
	id: number;
	shapeIndex: number;
	vias: Position[];
	entryIndex: number;
	exitIndex: number;
	key: string;
	preferred: boolean;
};

type CandidateDraft = Omit<
	ShapeTraversalCandidate,
	'id' | 'shapeIndex' | 'entryIndex' | 'exitIndex'
>;

export type ShapeOptimizationProblem = {
	coordinates: Position[];
	shapes: ShapeTraversalCandidate[][];
};

function positionKey(position: Position): string {
	return `${position[0]},${position[1]}`;
}

function traversalKey(vias: Position[]): string {
	return vias.map(positionKey).join(';');
}

function reverseOpen(vias: Position[]): Position[] {
	return [...vias].reverse();
}

function rotateClosed(ring: Position[], anchor: number, reverse: boolean): Position[] {
	const rotated = Array.from({ length: ring.length }, (_, offset) => {
		const index = reverse
			? (anchor - offset + ring.length) % ring.length
			: (anchor + offset) % ring.length;
		return ring[index]!;
	});
	return [...rotated, rotated[0]!];
}

function candidateDrafts(shape: PreparedRouteShape): CandidateDraft[] {
	const drafts: CandidateDraft[] = [];
	const seen = new Set<string>();
	const originalKey = traversalKey(shape.vias);
	const add = (vias: Position[]) => {
		const key = traversalKey(vias);
		if (seen.has(key)) return;
		seen.add(key);
		drafts.push({ vias, key, preferred: key === originalKey });
	};

	if (!shape.closed) {
		add([...shape.vias]);
		add(reverseOpen(shape.vias));
	} else {
		const ring = shape.vias.slice(0, -1);
		for (let anchor = 0; anchor < ring.length; anchor++) {
			add(rotateClosed(ring, anchor, false));
			add(rotateClosed(ring, anchor, true));
		}
	}

	return drafts.sort(
		(a, b) => Number(b.preferred) - Number(a.preferred) || a.key.localeCompare(b.key)
	);
}

/**
 * Build deterministic traversal candidates and the unique coordinates needed
 * by the Valhalla matrix endpoint. Canonical shape ordering makes equal-cost results independent
 * of the FeatureCollection order.
 */
export function buildShapeOptimizationProblem(
	inputShapes: PreparedRouteShape[]
): ShapeOptimizationProblem {
	const canonical = inputShapes
		.map((shape) => {
			const drafts = candidateDrafts(shape);
			const shapeKey = drafts.reduce(
				(minimum, candidate) => (candidate.key < minimum ? candidate.key : minimum),
				drafts[0]?.key ?? ''
			);
			return { drafts, shapeKey };
		})
		.sort((a, b) => a.shapeKey.localeCompare(b.shapeKey));

	const coordinates: Position[] = [];
	const coordinateIndexes = new Map<string, number>();
	const coordinateIndex = (position: Position) => {
		const key = positionKey(position);
		const existing = coordinateIndexes.get(key);
		if (existing != null) return existing;
		const index = coordinates.length;
		coordinates.push(position);
		coordinateIndexes.set(key, index);
		return index;
	};

	let nextCandidateId = 0;
	const shapes = canonical.map(({ drafts }, shapeIndex) =>
		drafts.map((draft) => ({
			...draft,
			id: nextCandidateId++,
			shapeIndex,
			entryIndex: coordinateIndex(draft.vias[0]!),
			exitIndex: coordinateIndex(draft.vias[draft.vias.length - 1]!)
		}))
	);

	return { coordinates, shapes };
}
