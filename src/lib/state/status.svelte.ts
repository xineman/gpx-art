import type { Feature, Geometry } from 'geojson';
import {
	distanceLabelFromFeatures,
	featuresPointCount,
	pointLabelFromCount
} from '$lib/geometry/stats';
import { pointer } from '$lib/util/pointer.svelte';
import { drawings } from './drawings.svelte';
import { toolById, tools, type ToolId } from './tools.svelte';

/**
 * Ephemeral flash messages (e.g. "Rectangle added.") sit on top of a
 * derived baseline so status never goes permanently stale the way a
 * purely imperative string can.
 */
let flash = $state<string | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** Live draft geometry while the user is mid-stroke (null when idle). */
let draftGeometry = $state<Geometry | null>(null);
let draftTool = $state<ToolId | null>(null);
let draftVertexCount = $state(0);
let draftCanFinish = $state(false);

const FLASH_MS = 2200;

function toolLabel(id: string): string {
	return toolById(id)?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Idle tool line: short on mouse, instructional on touch. */
function toolReadyStatus(id: ToolId): string {
	const def = toolById(id);
	if (!def) return `${toolLabel(id)} ready.`;

	// Touch / coarse pointer: status bar is the hint channel.
	if (!pointer.fineHover) {
		return `${def.label} · ${def.touchHint}`;
	}

	// Fine pointer: tooltips carry the full hint; keep status light.
	return `${def.label} ready.`;
}

function draftingStatus(tool: ToolId): string {
	const touch = !pointer.fineHover;

	switch (tool) {
		case 'pencil':
			return touch ? 'Drawing · lift finger to finish' : 'Drawing pencil stroke.';
		case 'rectangle':
			return touch ? 'Rectangle · drag, then release' : 'Sizing rectangle.';
		case 'polyline':
			if (!draftCanFinish) {
				return touch ? 'Polyline · tap to add vertices' : 'Polyline · click to add vertices';
			}
			return touch
				? 'Polyline · double-tap last point to finish'
				: 'Polyline · double-click or Enter to finish';
		case 'polygon':
			if (draftVertexCount < 3) {
				return touch
					? `Polygon · tap vertices (${draftVertexCount}/3)`
					: `Polygon · click vertices (${draftVertexCount}/3)`;
			}
			return touch
				? 'Polygon · double-tap last point to close'
				: 'Polygon · double-click or Enter to close';
		default:
			return toolReadyStatus(tools.active);
	}
}

function baselineStatus(): string {
	// Temporary Space-pan is a mode, not a tool pick.
	if (tools.spaceHeld) return 'Map navigation active.';

	const tool = tools.active;

	if (draftTool != null) {
		return draftingStatus(draftTool);
	}

	// Empty canvas + default pencil: gentle invite before the first pick.
	if (drawings.features.length === 0 && tool === 'pencil' && pointer.fineHover) {
		return 'Sketch a shape.';
	}

	return toolReadyStatus(tool);
}

function featuresForStats(): Feature[] {
	const committed = drawings.features;
	if (!draftGeometry || !draftTool) return committed;
	return [
		...committed,
		{
			type: 'Feature',
			properties: { tool: draftTool, id: '__draft__' },
			geometry: draftGeometry
		}
	];
}

function clearFlashInternal() {
	if (flashTimer) clearTimeout(flashTimer);
	flashTimer = null;
	flash = null;
}

// Tool / Space-pan changes should not stay buried under a finished-shape flash.
// Owned here (not StatusBar) so any status consumer gets the same behavior.
tools.onModeChange(() => {
	clearFlashInternal();
});

export const status = {
	get message() {
		return flash ?? baselineStatus();
	},
	get distanceLabel() {
		return distanceLabelFromFeatures(featuresForStats());
	},
	get pointLabel() {
		// Use committed draft vertices only — not the rubber-band cursor in draft geometry.
		const committed = featuresPointCount(drawings.features);
		return pointLabelFromCount(committed + draftVertexCount);
	},
	get draftActive() {
		return draftTool != null;
	},
	/**
	 * Report live draft from DrawingController.
	 * Pass `tool: null` to clear.
	 */
	setDraft(
		tool: ToolId | null,
		geometry: Geometry | null = null,
		meta: { vertexCount?: number; canFinish?: boolean } = {}
	) {
		// Starting a stroke should not sit under a previous "… finished." flash.
		if (tool != null && draftTool == null) this.clearFlash();
		draftTool = tool;
		draftGeometry = tool ? geometry : null;
		draftVertexCount = tool ? (meta.vertexCount ?? 0) : 0;
		draftCanFinish = tool ? (meta.canFinish ?? false) : false;
	},
	/** Short-lived override; baseline resumes when it expires. */
	flash(message: string, ms = FLASH_MS) {
		if (flashTimer) clearTimeout(flashTimer);
		flash = message;
		flashTimer = setTimeout(() => {
			flash = null;
			flashTimer = null;
		}, ms);
	},
	/** Drop a pending flash (e.g. when the user switches tools). */
	clearFlash() {
		clearFlashInternal();
	},
	/** Called after a successful commit so the bar acknowledges the action. */
	announceCommit(tool: string) {
		const label = toolLabel(tool);
		switch (tool) {
			case 'pencil':
				this.flash('Pencil line finished.');
				break;
			case 'rectangle':
				this.flash('Rectangle added.');
				break;
			case 'polyline':
			case 'polygon':
				this.flash(`${label} finished.`);
				break;
			default:
				this.flash(`${label} added.`);
		}
	}
};
