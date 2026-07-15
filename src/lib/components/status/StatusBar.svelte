<script lang="ts">
	import MapPinned from '@lucide/svelte/icons/map-pinned';
	import { status } from '$lib/state/status.svelte';
	import { pointer } from '$lib/util/pointer.svelte';

	interface Props {
		class?: string;
	}

	let { class: extraClass = '' }: Props = $props();
</script>

<section
	class={[
		'flex min-w-[min(430px,calc(100vw-36px))] items-center justify-between gap-4.5',
		'rounded-lg border border-panel/15 bg-ink-bright/90 px-3.5 py-3 shadow-panel',
		'max-[620px]:w-full max-[620px]:min-w-0 max-[620px]:flex-col max-[620px]:items-start max-[620px]:gap-2.25 max-[620px]:p-2.75',
		extraClass
	]}
	aria-label="Workspace status"
	aria-live="polite"
>
	<div class="flex min-w-0 items-center gap-2.5">
		<MapPinned class="shrink-0 text-trail-deep" size={21} strokeWidth={2.4} aria-hidden="true" />
		<div class="min-w-0">
			<p class="m-0 font-serif text-xl leading-none font-bold text-ink-dark">GPX Art</p>
			<span
				class={[
					'mt-1 block text-xs leading-snug text-ink-soft',
					// Touch hints are longer; allow wrap. Fine-pointer keeps a single clipped line.
					pointer.fineHover
						? 'overflow-hidden text-ellipsis whitespace-nowrap'
						: 'text-pretty max-[620px]:whitespace-normal'
				]}
			>
				{status.message}
			</span>
		</div>
	</div>
	<div class="flex shrink-0 items-center gap-1.5" aria-label="Sketch statistics">
		<span
			class="rounded-full bg-panel px-2.25 py-1.75 text-xs leading-none font-bold text-ink-bright"
		>
			{status.distanceLabel}
		</span>
		<span
			class="rounded-full bg-panel px-2.25 py-1.75 text-xs leading-none font-bold text-ink-bright"
		>
			{status.pointLabel}
		</span>
	</div>
</section>
