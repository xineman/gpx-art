import type { Shape } from '$lib/types/sketch';

export function cloneShape(shape: Shape): Shape {
	return {
		id: shape.id,
		points: shape.points.map((point) => ({ ...point })),
		type: shape.type
	};
}

export function cloneShapes(source: Shape[]) {
	return source.map(cloneShape);
}
