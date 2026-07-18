import { SvelteSet } from 'svelte/reactivity';

export type ToolId = 'pencil' | 'polyline' | 'polygon' | 'rectangle' | 'pan';

export type ToolDef = {
	id: ToolId;
	label: string;
	/** Mouse / hover-tooltip wording. */
	hint: string;
	/** Status-bar wording on touch / coarse pointers (no hover). */
	touchHint: string;
	shortcut: string;
};

export const TOOLS: readonly ToolDef[] = [
	{
		id: 'pencil',
		label: 'Pencil',
		hint: 'Freehand trail',
		touchHint: 'Freehand trail',
		shortcut: 'P'
	},
	{
		id: 'polyline',
		label: 'Polyline',
		hint: 'Click vertices · double-click or Enter to finish',
		touchHint: 'Tap vertices · double-tap last point to finish',
		shortcut: 'L'
	},
	{
		id: 'polygon',
		label: 'Polygon',
		hint: 'Click vertices · double-click or Enter to close',
		touchHint: 'Tap vertices · double-tap last point to close',
		shortcut: 'G'
	},
	{
		id: 'rectangle',
		label: 'Rectangle',
		hint: 'Drag to place a box',
		touchHint: 'Drag to place a box',
		shortcut: 'R'
	},
	{
		id: 'pan',
		label: 'Pan',
		hint: 'Drag the map · hold Space to pan',
		touchHint: 'Drag the map',
		shortcut: 'H'
	}
] as const;

export function toolById(id: string): ToolDef | undefined {
	return TOOLS.find((t) => t.id === id);
}

/**
 * Shared tool selection. Module-level runes (not a class) so every
 * importer shares the same reactive signals — avoids silent desync
 * between the tools panel and DrawingLayer.
 */
let active = $state<ToolId>('pencil');
let spaceHeld = $state(false);

/** Listeners for sticky-tool / Space-pan changes (e.g. status flash clear). */
const modeChangeListeners = new SvelteSet<() => void>();

function notifyModeChange() {
	for (const fn of modeChangeListeners) fn();
}

export const tools = {
	get active() {
		return active;
	},
	get spaceHeld() {
		return spaceHeld;
	},
	/** Tool that actually drives interaction right now. */
	get effective(): ToolId {
		return spaceHeld ? 'pan' : active;
	},
	get isPanning() {
		return spaceHeld || active === 'pan';
	},
	select(tool: ToolId) {
		const changed = active !== tool || spaceHeld;
		active = tool;
		// Selecting a tool ends temporary space-pan so the panel stays truthful
		spaceHeld = false;
		if (changed) notifyModeChange();
	},
	pressSpace() {
		if (spaceHeld) return;
		spaceHeld = true;
		notifyModeChange();
	},
	releaseSpace() {
		if (!spaceHeld) return;
		spaceHeld = false;
		notifyModeChange();
	},
	/**
	 * Subscribe to sticky-tool / Space-pan changes.
	 * Returns an unsubscribe function.
	 */
	onModeChange(fn: () => void): () => void {
		modeChangeListeners.add(fn);
		return () => modeChangeListeners.delete(fn);
	}
};
