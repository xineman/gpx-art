<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import Waypoints from '@lucide/svelte/icons/waypoints';
	import Hexagon from '@lucide/svelte/icons/hexagon';
	import Square from '@lucide/svelte/icons/square';
	import Hand from '@lucide/svelte/icons/hand';
	import { TOOLS, tools, type ToolId } from '$lib/state/tools.svelte';
	import ToolButton from './ToolButton.svelte';

	const icons: Record<ToolId, typeof Pencil> = {
		pencil: Pencil,
		polyline: Waypoints,
		polygon: Hexagon,
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

<aside
	class="absolute top-1/2 left-4 z-[2] flex w-[4.75rem] -translate-y-1/2 flex-col rounded-2xl border border-panel-edge/80 bg-linear-to-br from-panel-lift/90 to-panel/95 px-1.5 pt-2 pb-2 text-ink-bright shadow-[0_12px_40px_rgb(10_12_15_/_0.45),inset_0_1px_0_rgb(255_255_255_/_0.08)] backdrop-blur-md backdrop-saturate-125 select-none max-sm:top-auto max-sm:bottom-4 max-sm:left-1/2 max-sm:w-auto max-sm:max-w-[calc(100vw-2rem)] max-sm:translate-x-[-50%] max-sm:translate-y-0 max-sm:flex-row max-sm:items-center max-sm:gap-1.5 max-sm:px-2.5 max-sm:py-1.5"
	aria-label="Drawing tools"
>
	<header
		class="mb-1.5 flex flex-col items-center gap-1.5 border-b border-panel-edge/70 px-0 pt-0.5 pb-2 max-sm:mb-0 max-sm:flex-row max-sm:gap-1.5 max-sm:border-r max-sm:border-b-0 max-sm:py-0 max-sm:pr-2 max-sm:pl-0.5"
	>
		<span
			class="h-0.5 w-5 rounded-full bg-linear-to-r from-blaze to-trail max-sm:h-4 max-sm:w-0.5 max-sm:bg-linear-to-b"
			aria-hidden="true"
		></span>
		<span
			class="font-mono text-[0.58rem] font-semibold tracking-[0.18em] text-ink-muted uppercase max-sm:rotate-180 max-sm:tracking-[0.14em] max-sm:[writing-mode:vertical-rl]"
		>
			Tools
		</span>
	</header>

	<div
		class="flex flex-col gap-0.5 max-sm:flex-row max-sm:gap-0.5"
		role="toolbar"
		aria-orientation="vertical"
		aria-label="Draw"
	>
		{#each TOOLS as tool (tool.id)}
			{@const Icon = icons[tool.id]}
			<ToolButton id={tool.id} label={tool.label} hint={tool.hint} shortcut={tool.shortcut}>
				<Icon />
			</ToolButton>
		{/each}
	</div>

	<footer
		class="mt-1.5 flex flex-col items-center gap-0.5 border-t border-panel-edge/70 pt-2 text-center font-mono text-[0.55rem] leading-tight tracking-wide text-ink-muted max-sm:hidden"
	>
		<kbd
			class="inline-block rounded-[0.3rem] border border-panel-edge/90 bg-panel-lift/70 px-1.5 py-0.5 font-mono text-[0.52rem] tracking-wider text-ink-bright uppercase"
		>
			Space
		</kbd>
		<span>to pan</span>
	</footer>
</aside>
