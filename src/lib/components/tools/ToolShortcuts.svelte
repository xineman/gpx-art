<script lang="ts">
	import { tools, type ToolId } from '$lib/state/tools.svelte';

	/**
	 * Global tool letter shortcuts + Space-to-pan.
	 * Mounted once from FullscreenMap so dual ToolsPanel instances stay visual-only.
	 */
	const shortcutMap: Partial<Record<string, ToolId>> = {
		p: 'pencil',
		l: 'polyline',
		g: 'polygon',
		r: 'rectangle',
		h: 'pan'
	};

	function isTypingTarget(target: EventTarget | null) {
		if (!(target instanceof HTMLElement)) return false;
		const tag = target.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
	}

	function onKeyDown(e: KeyboardEvent) {
		if (isTypingTarget(e.target)) return;

		if (e.code === 'Space' && !e.repeat) {
			e.preventDefault();
			tools.pressSpace();
			return;
		}

		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const tool = shortcutMap[e.key.toLowerCase()];
		if (tool) {
			e.preventDefault();
			tools.select(tool);
		}
	}

	function onKeyUp(e: KeyboardEvent) {
		if (e.code === 'Space') {
			e.preventDefault();
			tools.releaseSpace();
		}
	}

	function onBlur() {
		// Don't leave the map stuck in space-pan if the window loses focus
		tools.releaseSpace();
	}
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={onBlur} />
