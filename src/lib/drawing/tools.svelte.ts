import { SvelteSet } from 'svelte/reactivity';
import type { ToolId } from './types';

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
