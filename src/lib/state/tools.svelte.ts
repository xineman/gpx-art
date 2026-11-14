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

/** Shared tool selection; all importers use the same reactive class instance. */
class ToolsState {
	#active = $state<ToolId>('pencil');
	#spaceHeld = $state(false);

	/** Listeners for sticky-tool / Space-pan changes (e.g. status flash clear). */
	#modeChangeListeners = new SvelteSet<() => void>();

	#notifyModeChange() {
		for (const fn of this.#modeChangeListeners) fn();
	}

	get active() {
		return this.#active;
	}
	get spaceHeld() {
		return this.#spaceHeld;
	}
	/** Tool that actually drives interaction right now. */
	get effective(): ToolId {
		return this.#spaceHeld ? 'pan' : this.#active;
	}
	get isPanning() {
		return this.#spaceHeld || this.#active === 'pan';
	}
	select(tool: ToolId) {
		const changed = this.#active !== tool || this.#spaceHeld;
		this.#active = tool;
		// Selecting a tool ends temporary space-pan so the panel stays truthful
		this.#spaceHeld = false;
		if (changed) this.#notifyModeChange();
	}
	pressSpace() {
		if (this.#spaceHeld) return;
		this.#spaceHeld = true;
		this.#notifyModeChange();
	}
	releaseSpace() {
		if (!this.#spaceHeld) return;
		this.#spaceHeld = false;
		this.#notifyModeChange();
	}
	/**
	 * Subscribe to sticky-tool / Space-pan changes.
	 * Returns an unsubscribe function.
	 */
	onModeChange(fn: () => void): () => void {
		this.#modeChangeListeners.add(fn);
		return () => this.#modeChangeListeners.delete(fn);
	}
}

export const tools = new ToolsState();
