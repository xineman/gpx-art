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
	// Whether the /match batch debug overlay is visible. Persisted across
	// undo/redo so the user's preference survives editing — but the actual
	// batch list is NOT snapshotted; it is recomputed on the next
	// createRoute() call. Treating the overlay as a transient view rather
	// than part of the document keeps undo semantics honest.
	routeDebugVisible?: boolean;
};
