<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ToolId } from '$lib/state/tools.svelte';
	import { tools } from '$lib/state/tools.svelte';

	interface Props {
		id: ToolId;
		label: string;
		hint: string;
		shortcut?: string;
		children: Snippet;
	}

	let { id, label, hint, shortcut, children }: Props = $props();

	/** Sticky selection for a11y; visual highlight follows the effective tool (incl. Space-pan). */
	const pressed = $derived(tools.active === id);
	const highlighted = $derived(tools.effective === id);
	const ariaLabel = $derived(shortcut ? `${label} (${shortcut})` : label);

	function activate() {
		tools.select(id);
	}
</script>

<div class="group/tooltip relative">
	<button
		type="button"
		class={[
			'inline-flex aspect-square w-9.5 cursor-pointer items-center justify-center rounded-md border-0',
			'transition-[background,color,transform,opacity] duration-150 ease-in-out',
			'hover:bg-blaze hover:text-ink-dark',
			'max-[620px]:w-full',
			highlighted ? 'bg-blaze text-ink-dark' : 'bg-transparent text-ink-bright'
		]}
		aria-label={ariaLabel}
		aria-pressed={pressed}
		onclick={activate}
	>
		{@render children()}
	</button>
	<span
		role="tooltip"
		class="pointer-events-none absolute top-1/2 left-full z-10 ml-2 flex translate-x-0.75 -translate-y-1/2 scale-[0.96] flex-col gap-0.5 rounded-md border border-panel-edge/15 bg-panel-lift px-3 pt-1.5 pb-2.5 opacity-0 shadow-tooltip transition-all duration-150 ease-out group-hover/tooltip:translate-x-0 group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100 max-[620px]:top-auto max-[620px]:bottom-full max-[620px]:left-1/2 max-[620px]:mb-2 max-[620px]:ml-0 max-[620px]:-translate-x-1/2 max-[620px]:-translate-y-0.75 max-[620px]:pb-1.5 max-[620px]:group-hover/tooltip:translate-y-0"
	>
		<span
			class="flex items-baseline gap-1.5 text-[10px] font-bold tracking-[0.14em] whitespace-nowrap text-ink-bright uppercase"
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
			class="text-[10px] leading-snug font-medium tracking-normal whitespace-nowrap text-ink-bright/60 normal-case"
		>
			{hint}
		</span>
		<span
			aria-hidden="true"
			class="absolute inset-x-2 bottom-1 h-[1.5px] rounded-full bg-blaze max-[620px]:hidden"
		></span>
		<span
			aria-hidden="true"
			class="absolute top-1/2 right-full -translate-y-1/2 border-y-4 border-r-[5px] border-y-transparent border-r-blaze max-[620px]:top-full max-[620px]:right-auto max-[620px]:left-1/2 max-[620px]:-translate-x-1/2 max-[620px]:translate-y-0 max-[620px]:border-x-4 max-[620px]:border-y-0 max-[620px]:border-t-4 max-[620px]:border-r-0 max-[620px]:border-x-transparent max-[620px]:border-t-blaze"
		></span>
	</span>
</div>
