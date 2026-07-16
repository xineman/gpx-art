<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import TooltipArrow from '$lib/components/ui/TooltipArrow.svelte';
	import { route } from '$lib/state/route.svelte';
	import { status } from '$lib/state/status.svelte';
	import { pointer } from '$lib/util/pointer.svelte';

	const showHoverTip = $derived(pointer.ready && pointer.fineHover);
	const canDownload = $derived(route.isReady);

	function onDownload() {
		if (!canDownload) return;
		route.downloadGpx();
		status.flash('GPX downloaded.');
	}
</script>

<div class="group/tooltip relative flex items-center justify-center">
	<button
		type="button"
		class={[
			'inline-flex size-9.5 shrink-0 items-center justify-center rounded-md border-0',
			'transition-[background,color,transform,opacity] duration-150 ease-in-out',
			canDownload
				? 'cursor-pointer bg-transparent text-ink-bright hover:bg-blaze hover:text-ink-dark'
				: 'cursor-not-allowed text-ink-soft opacity-45'
		]}
		aria-label={canDownload ? 'Download GPX' : 'Download GPX — route first'}
		disabled={!canDownload}
		onclick={onDownload}
	>
		<Download size={18} strokeWidth={2.15} />
	</button>

	{#if showHoverTip && canDownload}
		<span
			role="tooltip"
			class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-4 flex w-max -translate-x-1/2 -translate-y-0.75 scale-[0.96] flex-col items-center gap-0.5 rounded-md border border-panel-edge/15 bg-panel-lift px-2.5 pt-1.5 pb-2 text-center opacity-0 shadow-tooltip transition-all duration-150 ease-out group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100"
		>
			<span class="text-[10px] font-bold tracking-[0.14em] text-ink-bright uppercase">
				Download GPX
			</span>
			<span class="font-mono text-[9px] font-medium tracking-normal text-ink-muted normal-case">
				Route · {route.distanceLabel}
			</span>
			<TooltipArrow points="down" />
		</span>
	{/if}
</div>
