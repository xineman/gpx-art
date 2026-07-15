<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import Route from '@lucide/svelte/icons/route';
	import Pentagon from '@lucide/svelte/icons/pentagon';
	import Square from '@lucide/svelte/icons/square';
	import Hand from '@lucide/svelte/icons/hand';
	import { TOOLS, tools, type ToolId } from '$lib/state/tools.svelte';
	import ToolButton from './ToolButton.svelte';

	const icons: Record<ToolId, typeof Pencil> = {
		pencil: Pencil,
		polyline: Route,
		polygon: Pentagon,
		rectangle: Square,
		pan: Hand
	};

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

{#snippet toolButtons()}
	{#each TOOLS as tool (tool.id)}
		{@const Icon = icons[tool.id]}
		<ToolButton id={tool.id} label={tool.label} hint={tool.hint} shortcut={tool.shortcut}>
			<Icon size={18} />
		</ToolButton>
	{/each}
{/snippet}

<!-- Desktop: vertical icon rail, top-left -->
<div
	class="absolute top-4.5 left-4.5 z-2 grid items-center gap-1.25 rounded-lg border border-panel-edge/25 bg-panel p-1.5 shadow-panel max-[620px]:hidden"
	aria-label="Drawing tools"
	role="toolbar"
	aria-orientation="vertical"
>
	{@render toolButtons()}
</div>

<!-- Mobile: horizontal strip, bottom full-width -->
<div
	class="absolute right-3 bottom-3 left-3 z-2 hidden grid-cols-5 items-center gap-1.25 rounded-lg border border-panel-edge/25 bg-panel p-1.5 shadow-panel max-[620px]:grid"
	aria-label="Drawing tools"
	role="toolbar"
	aria-orientation="horizontal"
>
	{@render toolButtons()}
</div>
