import type { Geometry, LineString } from 'geojson';
import { closedLineString, lineString, rectangleLineString } from './geo';

export type DrawingPosition = [lng: number, lat: number];
export type VertexTool = 'polyline' | 'polygon';
export type VertexDraft = {
	kind: VertexTool;
	points: DrawingPosition[];
	cursor: DrawingPosition | null;
};
export type DragDraft =
	| { kind: 'pencil'; points: DrawingPosition[] }
	| { kind: 'rectangle'; start: DrawingPosition; end: DrawingPosition };
export type Draft = DragDraft | VertexDraft;

export type DraftSnapshot = {
	tool: Draft['kind'];
	geometry: Geometry | null;
	/** Placed vertices, excluding the rubber-band cursor. */
	vertexCount: number;
	canFinish: boolean;
};

export function canFinishVertices(tool: VertexTool, pointCount: number): boolean {
	return pointCount >= (tool === 'polygon' ? 3 : 2);
}

/** Derive the map preview and the status snapshot from the same draft. */
export function projectDraft(draft: Draft | null) {
	if (!draft) return { geometry: null, vertices: [], snapshot: null };

	let geometry: LineString | null = null;
	let vertices: DrawingPosition[] = [];
	let vertexCount: number;
	let canFinish = false;

	switch (draft.kind) {
		case 'pencil':
			vertexCount = draft.points.length;
			if (vertexCount >= 2) geometry = lineString(draft.points);
			else vertices = draft.points;
			break;
		case 'rectangle':
			geometry = rectangleLineString(draft.start, draft.end);
			vertices = [draft.start, draft.end];
			vertexCount = 2;
			break;
		case 'polyline':
		case 'polygon': {
			vertices = draft.points;
			vertexCount = vertices.length;
			canFinish = canFinishVertices(draft.kind, vertexCount);
			const points = draft.cursor ? [...vertices, draft.cursor] : vertices;
			if (draft.kind === 'polygon' && points.length >= 3) geometry = closedLineString(points);
			else if (points.length >= 2) geometry = lineString(points);
			break;
		}
	}

	const first = vertices[0];
	const snapshot: DraftSnapshot = {
		tool: draft.kind,
		geometry: geometry ?? (first ? { type: 'Point', coordinates: first } : null),
		vertexCount,
		canFinish
	};
	return { geometry, vertices, snapshot };
}
