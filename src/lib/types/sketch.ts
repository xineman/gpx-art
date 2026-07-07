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
	routedPath: Point[] | null;
	shapes: Shape[];
	// Trim sub-mode of phase: 'routed'. Optional because older persisted
	// snapshots predate the feature; missing fields are treated as "not in
	// trim mode" by the state class. Undo/redo round-trips these so a
	// mid-trim Cmd/Ctrl+Z returns to the previous pick set.
	trimMode?: boolean;
	trimStart?: number | null;
	trimEnd?: number | null;
	trimHint?: string;
};
