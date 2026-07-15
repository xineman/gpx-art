<script lang="ts">
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import { drawings } from '$lib/state/drawings.svelte';
	import { pointer } from '$lib/util/pointer.svelte';

	/**
	 * Platform-aware keycap labels for tooltips.
	 * Detect once on the client; SSR falls back to Ctrl so markup stays stable.
	 */
	const isApple =
		typeof navigator !== 'undefined' &&
		/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

	const undoShortcut = isApple ? '⌘Z' : 'Ctrl+Z';
	const redoShortcut = isApple ? '⌘⇧Z' : 'Ctrl+Y';

	const showHoverTip = $derived(pointer.ready && pointer.fineHover);
	const canUndo = $derived(drawings.canUndo);
	const canRedo = $derived(drawings.canRedo);
</script>

{#snippet historyButton(
	label: string,
	shortcut: string,
	disabled: boolean,
	onclick: () => void,
	icon: typeof Undo2
)}
	{@const Icon = icon}
	{@const ariaLabel = `${label} (${shortcut})`}
	<div class="group/tooltip relative flex items-center justify-center">
		<button
			type="button"
			class={[
				'inline-flex size-9.5 shrink-0 items-center justify-center rounded-md border-0',
				'transition-[background,color,transform,opacity] duration-150 ease-in-out',
				disabled
					? 'cursor-not-allowed text-ink-soft opacity-45'
					: 'cursor-pointer bg-transparent text-ink-bright hover:bg-blaze hover:text-ink-dark'
			]}
			aria-label={ariaLabel}
			{disabled}
			{onclick}
		>
			<Icon size={18} strokeWidth={2.15} />
		</button>

		{#if showHoverTip && !disabled}
			<span
				role="tooltip"
				class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 flex w-max -translate-x-1/2 -translate-y-0.75 scale-[0.96] flex-col items-center gap-0.5 rounded-md border border-panel-edge/15 bg-panel-lift px-2.5 pt-1.5 pb-2 text-center opacity-0 shadow-tooltip transition-all duration-150 ease-out group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100"
			>
				<span
					class="flex items-baseline justify-center gap-1.5 text-[10px] font-bold tracking-[0.14em] text-ink-bright uppercase"
				>
					{label}
					<span
						class="rounded border border-panel-edge/30 px-1 py-px font-mono text-[9px] font-semibold tracking-normal text-ink-bright/75 normal-case"
					>
						{shortcut}
					</span>
				</span>
				<span
					aria-hidden="true"
					class="absolute top-full left-1/2 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-blaze"
				></span>
			</span>
		{/if}
	</div>
{/snippet}

<div
	class="inline-grid grid-flow-col auto-cols-max items-center gap-1 rounded-xl border border-panel-edge/20 bg-panel/95 p-2 shadow-panel backdrop-blur-sm"
	aria-label="History"
	role="toolbar"
	aria-orientation="horizontal"
>
	{@render historyButton('Undo', undoShortcut, !canUndo, () => drawings.undo(), Undo2)}
	{@render historyButton('Redo', redoShortcut, !canRedo, () => drawings.redo(), Redo2)}
</div>
