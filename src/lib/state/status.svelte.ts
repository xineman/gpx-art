import type { Feature, Geometry } from 'geojson';
import {
	distanceLabelFromFeatures,
	featuresPointCount,
	pointLabelFromCount
} from '#lib/geometry/stats.js';
import { pointer } from '#lib/util/pointer.svelte.js';
import { drawings } from './drawings.svelte';
import { toolById, tools, type ToolId } from './tools.svelte';

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

/**
 * Flash messages sit on top of the live draft and tool baseline.
 * The shared instance owns the timer and tool-change subscription.
 */
class StatusState {
	#flash = $state<string | null>(null);
	#flashTimer: ReturnType<typeof setTimeout> | undefined;
	#draftGeometry = $state<Geometry | null>(null);
	#draftTool = $state<ToolId | null>(null);
	#draftVertexCount = $state(0);
	#draftCanFinish = $state(false);

	constructor() {
		// Any status consumer gets flash clearing when the tool or Space-pan changes.
		tools.onModeChange(() => this.clearFlash());
	}

	get message() {
		return this.#flash ?? this.#baselineStatus();
	}

	get distanceLabel() {
		return distanceLabelFromFeatures(this.#featuresForStats());
	}

	get pointLabel() {
		// Count committed draft vertices, not the rubber-band cursor.
		const committed = featuresPointCount(drawings.features);
		return pointLabelFromCount(committed + this.#draftVertexCount);
	}

	get draftActive() {
		return this.#draftTool != null;
	}

	/** Report a live draft; pass `tool: null` to clear it. */
	setDraft(
		tool: ToolId | null,
		geometry: Geometry | null = null,
		meta: { vertexCount?: number; canFinish?: boolean } = {}
	) {
		// Starting a stroke should not sit under a finished-shape flash.
		if (tool != null && this.#draftTool == null) this.clearFlash();
		this.#draftTool = tool;
		this.#draftGeometry = tool ? geometry : null;
		this.#draftVertexCount = tool ? (meta.vertexCount ?? 0) : 0;
		this.#draftCanFinish = tool ? (meta.canFinish ?? false) : false;
	}

	/** Short-lived override; the baseline resumes when it expires. */
	flash(message: string, ms = FLASH_MS) {
		clearTimeout(this.#flashTimer);
		this.#flash = message;
		this.#flashTimer = setTimeout(() => {
			this.#flash = null;
			this.#flashTimer = undefined;
		}, ms);
	}

	clearFlash() {
		clearTimeout(this.#flashTimer);
		this.#flashTimer = undefined;
		this.#flash = null;
	}

	/** Acknowledge a committed drawing. */
	announceCommit(tool: string, closed = false) {
		if (closed) {
			this.flash('Closed loop added.');
			return;
		}
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

	#draftingStatus(tool: ToolId): string {
		const touch = !pointer.fineHover;

		switch (tool) {
			case 'pencil':
				return touch ? 'Drawing · lift finger to finish' : 'Drawing pencil stroke.';
			case 'rectangle':
				return touch ? 'Rectangle · drag, then release' : 'Sizing rectangle.';
			case 'polyline':
				if (!this.#draftCanFinish) {
					return touch ? 'Polyline · tap to add vertices' : 'Polyline · click to add vertices';
				}
				return touch
					? 'Polyline · double-tap last point to finish'
					: 'Polyline · double-click or Enter to finish';
			case 'polygon':
				if (this.#draftVertexCount < 3) {
					return touch
						? `Polygon · tap vertices (${this.#draftVertexCount}/3)`
						: 'Polygon · click vertices';
				}
				return touch
					? 'Polygon · double-tap last point to close'
					: 'Polygon · double-click or Enter to close';
			default:
				return toolReadyStatus(tools.active);
		}
	}

	#baselineStatus(): string {
		if (tools.spaceHeld) return 'Map navigation active.';
		const tool = tools.active;
		if (this.#draftTool != null) return this.#draftingStatus(this.#draftTool);
		if (drawings.features.length === 0 && tool === 'pencil' && pointer.fineHover) {
			return 'Sketch a shape.';
		}
		return toolReadyStatus(tool);
	}

	#featuresForStats(): Feature[] {
		const committed = drawings.features;
		if (!this.#draftGeometry || !this.#draftTool) return committed;
		return [
			...committed,
			{
				type: 'Feature',
				properties: { tool: this.#draftTool, id: '__draft__' },
				geometry: this.#draftGeometry
			}
		];
	}
}

export const status = new StatusState();
