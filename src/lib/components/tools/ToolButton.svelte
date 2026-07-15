<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ToolId } from '$lib/state/tools.svelte';
	import { tools } from '$lib/state/tools.svelte';
	import { pointer } from '$lib/util/pointer.svelte';

	interface Props {
		id: ToolId;
		label: string;
		hint: string;
		shortcut?: string;
		/** Desktop rail is compact; mobile dock uses a slightly larger thumb target. */
		size?: 'sm' | 'md';
		/**
		 * Where the tooltip sits relative to the button.
		 * Keep this explicit (not only media queries) so hover transforms
		 * cannot override the wrong axis on the other layout.
		 */
		tip?: 'right' | 'above';
		children: Snippet;
	}

	let { id, label, hint, shortcut, size = 'sm', tip = 'right', children }: Props = $props();

	/** Sticky selection for a11y; visual highlight follows the effective tool (incl. Space-pan). */
	const pressed = $derived(tools.active === id);
	const highlighted = $derived(tools.effective === id);
	const ariaLabel = $derived(shortcut ? `${label} (${shortcut})` : label);
	/**
	 * Hover tooltips only after client pointer init on fine-pointer devices.
	 * Touch / SSR stay tooltip-free (status bar carries hints).
	 */
	const showHoverTip = $derived(pointer.ready && pointer.fineHover);
</script>

{#snippet tipContent(align: 'start' | 'center', hintClass: string)}
	<span
		class={[
			'flex items-baseline gap-1.5 text-[10px] font-bold tracking-[0.14em] text-ink-bright uppercase',
			align === 'center' && 'justify-center'
		]}
	>
		{label}
		{#if shortcut}
			<span
				class="rounded border border-panel-edge/30 px-1 py-px font-mono text-[9px] font-semibold tracking-normal text-ink-bright/75 normal-case"
			>
				{shortcut}
			</span>
		{/if}
	</span>
	<span
		class={[
			'text-[10px] leading-snug font-medium tracking-normal text-ink-bright/60 normal-case',
			hintClass
		]}
	>
		{hint}
	</span>
{/snippet}

<div class="group/tooltip relative flex items-center justify-center">
	<button
		type="button"
		class={[
			// Fixed square — never stretch to the grid cell width.
			'inline-flex shrink-0 cursor-pointer items-center justify-center border-0',
			'transition-[background,color,transform,opacity] duration-150 ease-in-out',
			'hover:bg-blaze hover:text-ink-dark',
			size === 'md' ? 'size-10 rounded-lg' : 'size-9.5 rounded-md',
			highlighted ? 'bg-blaze text-ink-dark' : 'bg-transparent text-ink-bright'
		]}
		aria-label={ariaLabel}
		aria-pressed={pressed}
		onclick={() => tools.select(id)}
	>
		{@render children()}
	</button>

	{#if showHoverTip && tip === 'right'}
		<!-- Desktop: fly out to the right of the vertical rail. -->
		<span
			role="tooltip"
			class="pointer-events-none absolute top-1/2 left-full z-10 ml-2 flex translate-x-0.75 -translate-y-1/2 scale-[0.96] flex-col gap-0.5 rounded-md border border-panel-edge/15 bg-panel-lift px-3 pt-1.5 pb-2.5 opacity-0 shadow-tooltip transition-all duration-150 ease-out group-hover/tooltip:translate-x-0 group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100"
		>
			{@render tipContent('start', 'whitespace-nowrap')}
			<span aria-hidden="true" class="absolute inset-x-2 bottom-1 h-[1.5px] rounded-full bg-blaze"
			></span>
			<span
				aria-hidden="true"
				class="absolute top-1/2 right-full -translate-y-1/2 border-y-4 border-r-[5px] border-y-transparent border-r-blaze"
			></span>
		</span>
	{:else if showHoverTip && tip === 'above'}
		<!-- Narrow window with fine hover (e.g. resized desktop): tip above the dock. -->
		<span
			role="tooltip"
			class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 flex w-max max-w-[min(220px,calc(100vw-24px))] -translate-x-1/2 -translate-y-0.75 scale-[0.96] flex-col items-center gap-0.5 rounded-md border border-panel-edge/15 bg-panel-lift px-2.5 pt-1.5 pb-2 text-center opacity-0 shadow-tooltip transition-all duration-150 ease-out group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100"
		>
			{@render tipContent('center', 'text-balance')}
			<span
				aria-hidden="true"
				class="absolute top-full left-1/2 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-blaze"
			></span>
		</span>
	{/if}
</div>
