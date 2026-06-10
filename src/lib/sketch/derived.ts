import { closeShape } from '$lib/geometry/point';
import { formatDistance, totalDistance } from '$lib/geometry/distance';
import type { Point, Shape } from '$lib/types/sketch';

export interface SketchStateLike {
	shapes: Shape[];
	draft: Shape | null;
}

export function routeInputPoints(state: SketchStateLike): Point[] {
	const committed = state.shapes.flatMap((shape) =>
		shape.type === 'polygon' || shape.type === 'rectangle' ? closeShape(shape.points) : shape.points
	);
	const pending = state.draft
		? state.draft.type === 'polygon'
			? closeShape(state.draft.points)
			: state.draft.points
		: [];

	return [...committed, ...pending];
}

export function sketchDistance(state: SketchStateLike) {
	return totalDistance(routeInputPoints(state));
}

export function distanceLabel(state: SketchStateLike) {
	return formatDistance(sketchDistance(state));
}

export function canRoute(state: SketchStateLike) {
	return routeInputPoints(state).length > 1;
}
