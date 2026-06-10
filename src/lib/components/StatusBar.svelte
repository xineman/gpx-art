<script lang="ts">
	import { MapPinned } from '@lucide/svelte';
	import type { SketchState } from '$lib/sketch/state.svelte';

	type Props = {
		state: SketchState;
		class?: string;
	};
	let { state, class: extraClass = '' }: Props = $props();
</script>

<section
	class="flex min-w-[min(430px,calc(100vw-36px))] items-center justify-between gap-[18px] rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/90 px-[14px] py-3 shadow-[0_18px_50px_rgb(27_26_23_/_0.20)] max-[620px]:w-full max-[620px]:min-w-0 max-[620px]:flex-col max-[620px]:items-start max-[620px]:gap-[9px] max-[620px]:p-[11px] {extraClass}"
	aria-label="Workspace status"
>
	<div class="flex min-w-0 items-center gap-2.5">
		<MapPinned color="#1e7d62" size={21} strokeWidth={2.4} />
		<div>
			<p class="m-0 font-serif text-xl leading-none font-bold">GPX Art</p>
			<span
				class="mt-1 block overflow-hidden text-xs leading-[1.2] text-ellipsis whitespace-nowrap text-[#67604f]"
			>
				{state.status}
			</span>
		</div>
	</div>
	<div class="flex shrink-0 items-center gap-1.5" aria-label="Route statistics">
		<span
			class="rounded-full bg-[#2c2924] px-[9px] py-[7px] text-xs leading-none font-bold text-[#fff7df]"
		>
			{state.distanceLabel}
		</span>
		<span
			class="rounded-full bg-[#2c2924] px-[9px] py-[7px] text-xs leading-none font-bold text-[#fff7df]"
		>
			{state.pointLabel}
		</span>
	</div>
</section>
