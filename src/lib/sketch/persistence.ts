import type { ShapeType, Snapshot } from '$lib/types/sketch';

export const SNAPSHOT_FORMAT = 'gpx-art-drawing';
export const SNAPSHOT_VERSION = 1;

export type SnapshotEnvelope = {
	format: typeof SNAPSHOT_FORMAT;
	version: typeof SNAPSHOT_VERSION;
	snapshot: Snapshot;
};

export function buildSnapshotEnvelope(snapshot: Snapshot): SnapshotEnvelope {
	return { format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION, snapshot };
}

type ParseResult = { ok: true; snapshot: Snapshot } | { ok: false; reason: string };

export function parseSnapshotEnvelope(input: unknown): ParseResult {
	if (input === null || typeof input !== 'object') {
		return { ok: false, reason: 'not a JSON object.' };
	}
	const obj = input as Record<string, unknown>;

	if (obj.format !== SNAPSHOT_FORMAT) {
		return { ok: false, reason: `format must be "${SNAPSHOT_FORMAT}".` };
	}
	if (obj.version !== SNAPSHOT_VERSION) {
		return {
			ok: false,
			reason: `version ${String(obj.version)} isn't supported (expected ${SNAPSHOT_VERSION}).`
		};
	}
	if (!('snapshot' in obj)) {
		return { ok: false, reason: 'missing "snapshot".' };
	}

	const snap = obj.snapshot as Record<string, unknown> | null | undefined;
	const shapeFail = validateShapeArray(snap?.shapes, 'snapshot.shapes');
	if (shapeFail) return { ok: false, reason: shapeFail };

	const draftFail = validateShape(snap?.draft, 'snapshot.draft');
	if (draftFail) return { ok: false, reason: draftFail };

	const phaseFail = validatePhase(snap?.phase, 'snapshot.phase');
	if (phaseFail) return { ok: false, reason: phaseFail };

	const routedFail = validatePointArray(snap?.routedPath, 'snapshot.routedPath');
	if (routedFail) return { ok: false, reason: routedFail };

	// Trim sub-mode is optional. Older saved files (version 1) predate
	// these fields; treat them as "not in trim mode" so loading an old
	// file still works without a version bump.
	const trimMode = snap?.trimMode;
	if (trimMode !== undefined && typeof trimMode !== 'boolean') {
		return { ok: false, reason: 'snapshot.trimMode must be a boolean when present.' };
	}
	const trimStart = snap?.trimStart;
	if (
		trimStart !== undefined &&
		trimStart !== null &&
		(typeof trimStart !== 'number' || !Number.isFinite(trimStart) || !Number.isInteger(trimStart))
	) {
		return { ok: false, reason: 'snapshot.trimStart must be an integer when present.' };
	}
	const trimEnd = snap?.trimEnd;
	if (
		trimEnd !== undefined &&
		trimEnd !== null &&
		(typeof trimEnd !== 'number' || !Number.isFinite(trimEnd) || !Number.isInteger(trimEnd))
	) {
		return { ok: false, reason: 'snapshot.trimEnd must be an integer when present.' };
	}
	const trimHint = snap?.trimHint;
	if (trimHint !== undefined && typeof trimHint !== 'string') {
		return { ok: false, reason: 'snapshot.trimHint must be a string when present.' };
	}

	// /match batch debug overlay toggle — optional so older saved files
	// (pre-feature) still import without a version bump.
	const routeDebugVisible = snap?.routeDebugVisible;
	if (routeDebugVisible !== undefined && typeof routeDebugVisible !== 'boolean') {
		return { ok: false, reason: 'snapshot.routeDebugVisible must be a boolean when present.' };
	}

	return {
		ok: true,
		snapshot: {
			shapes: (snap?.shapes ?? []) as Snapshot['shapes'],
			draft: (snap?.draft ?? null) as Snapshot['draft'],
			phase: snap?.phase as Snapshot['phase'],
			routedPath: (snap?.routedPath ?? null) as Snapshot['routedPath'],
			trimMode,
			trimStart,
			trimEnd,
			trimHint,
			routeDebugVisible
		}
	};
}

function validateShapeArray(value: unknown, path: string): string | null {
	if (!Array.isArray(value)) return `${path} must be an array.`;
	for (let i = 0; i < value.length; i++) {
		const fail = validateShape(value[i], `${path}[${i}]`);
		if (fail) return fail;
	}
	return null;
}

function validateShape(value: unknown, path: string): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'object') return `${path} must be an object.`;
	const shape = value as Record<string, unknown>;
	if (typeof shape.id !== 'string' || shape.id === '')
		return `${path}.id must be a non-empty string.`;
	if (!isShapeType(shape.type)) return `${path}.type must be one of pencil|line|polygon|rectangle.`;
	const pointsFail = validatePointArray(shape.points, `${path}.points`);
	if (pointsFail) return pointsFail;
	return null;
}

function validatePointArray(value: unknown, path: string): string | null {
	if (value === null || value === undefined) return null;
	if (!Array.isArray(value)) return `${path} must be an array.`;
	for (let i = 0; i < value.length; i++) {
		if (typeof value[i] !== 'object' || value[i] === null) return `${path}[${i}] must be a point.`;
		const p = value[i] as Record<string, unknown>;
		if (typeof p.lat !== 'number' || !Number.isFinite(p.lat))
			return `${path}[${i}].lat must be a finite number.`;
		if (typeof p.lng !== 'number' || !Number.isFinite(p.lng))
			return `${path}[${i}].lng must be a finite number.`;
	}
	return null;
}

function validatePhase(value: unknown, path: string): string | null {
	if (value !== 'editing' && value !== 'routing' && value !== 'routed')
		return `${path} must be editing|routing|routed.`;
	return null;
}

function isShapeType(value: unknown): value is ShapeType {
	return value === 'pencil' || value === 'line' || value === 'polygon' || value === 'rectangle';
}
