import type { Action } from 'svelte/action';

export type DismissibleLayerOptions = {
	onDismiss: () => void;
	trigger?: HTMLElement | null;
	initialFocus?: HTMLElement | null;
};

/** Close a floating layer on outside pointer input or Escape and restore keyboard focus. */
export const dismissibleLayer: Action<HTMLElement, DismissibleLayerOptions> = (node, options) => {
	let current = options;
	let active = true;
	const document = node.ownerDocument;

	function onPointerDown(event: PointerEvent) {
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (node.contains(target) || current.trigger?.contains(target)) return;
		current.onDismiss();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		const trigger = current.trigger;
		current.onDismiss();
		queueMicrotask(() => trigger?.focus());
	}

	document.addEventListener('pointerdown', onPointerDown, true);
	document.addEventListener('keydown', onKeyDown, true);
	queueMicrotask(() => {
		if (active) current.initialFocus?.focus();
	});

	return {
		update(next) {
			current = next;
		},
		destroy() {
			active = false;
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		}
	};
};
