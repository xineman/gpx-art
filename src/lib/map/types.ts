import type { Point } from '$lib/types/sketch';

/** Map-engine-agnostic pointer payload for sketch tools. */
export type MapPointerEvent = {
	point: Point;
	originalEvent: MouseEvent;
};
