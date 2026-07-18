<script lang="ts">
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TooltipArrow from '$lib/components/ui/TooltipArrow.svelte';
	import { drawings } from '$lib/state/drawings.svelte';
	import { status } from '$lib/state/status.svelte';
	import { dismissibleLayer } from '$lib/util/dismissible-layer';
	import { pointer } from '$lib/util/pointer.svelte';

	let open = $state(false);
	let triggerBtn = $state<HTMLButtonElement | null>(null);
	let confirmBtn = $state<HTMLButtonElement | null>(null);

	const showHoverTip = $derived(pointer.ready && pointer.fineHover && !open);
	const canClear = $derived(drawings.features.length > 0);

	function close() {
		open = false;
	}

	function toggle() {
		if (!canClear) return;
		open = !open;
	}

	function confirmClear() {
		if (!canClear) return;
		drawings.clearSketch();
		status.flash('Sketch cleared.');
		close();
	}
</script>

<div class="relative flex items-center justify-center">
	<div class="group/tooltip relative flex items-center justify-center">
		<button
			bind:this={triggerBtn}
			type="button"
			class={[
				'inline-flex size-9.5 shrink-0 items-center justify-center rounded-md border-0',
				'transition-[background,color,transform,opacity] duration-150 ease-in-out',
				!canClear
					? 'cursor-not-allowed text-ink-soft opacity-45'
					: open
						? 'cursor-pointer bg-ember text-ink-dark'
						: 'cursor-pointer bg-transparent text-ink-bright hover:bg-ember hover:text-ink-dark'
			]}
			aria-label="Clear sketch"
			aria-haspopup="dialog"
			aria-expanded={open}
			disabled={!canClear}
			onclick={toggle}
		>
			<Trash2 size={18} strokeWidth={2.15} />
		</button>

		{#if showHoverTip && canClear}
			<span
				role="tooltip"
				class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-4 flex w-max -translate-x-1/2 -translate-y-0.75 scale-[0.96] flex-col items-center gap-0.5 rounded-md border border-panel-edge/15 bg-panel-lift px-2.5 pt-1.5 pb-2 text-center opacity-0 shadow-tooltip transition-all duration-150 ease-out group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100"
			>
				<span class="text-[10px] font-bold tracking-[0.14em] text-ink-bright uppercase">
					Clear
				</span>
				<TooltipArrow points="down" />
			</span>
		{/if}
	</div>

	{#if open}
		<div
			use:dismissibleLayer={{ onDismiss: close, trigger: triggerBtn, initialFocus: confirmBtn }}
			role="dialog"
			aria-label="Clear sketch"
			class="absolute bottom-full left-1/2 z-20 mb-4 w-max min-w-40 -translate-x-1/2 rounded-md border border-panel-edge/15 bg-panel-lift p-1 shadow-tooltip"
		>
			<div class="px-2.5 pt-1.5 pb-1">
				<p class="text-[10px] font-bold tracking-[0.12em] text-ink-bright uppercase">
					Clear sketch?
				</p>
				<p class="mt-0.5 text-[10px] leading-snug text-ink-muted">Removes every shape.</p>
			</div>

			<button
				bind:this={confirmBtn}
				type="button"
				class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-sm border-0 bg-ember px-2.5 py-1.75 text-xs font-semibold text-ink-dark transition-[filter,opacity] duration-150 ease-in-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70 focus-visible:ring-offset-1 focus-visible:ring-offset-panel-lift"
				onclick={confirmClear}
			>
				<Trash2 size={14} strokeWidth={2.25} class="shrink-0 opacity-90" />
				Clear
			</button>
		</div>
	{/if}
</div>
