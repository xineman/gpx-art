export type Point = { lat: number; lng: number };

export const TOOLS = ['pan', 'pencil', 'line', 'polygon', 'rectangle'] as const;
export type Tool = (typeof TOOLS)[number];

export type ShapeType = Exclude<Tool, 'pan'>;

export const PHASES = ['editing', 'routing', 'routed'] as const;
export type Phase = (typeof PHASES)[number];

export type Shape = {
	id: string;
	type: ShapeType;
	points: Point[];
};

export type Snapshot = {
	draft: Shape | null;
	phase: Phase;
	shapes: Shape[];
};
