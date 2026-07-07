<script lang="ts">
	import {
		Check,
		Download,
		LoaderCircle,
		RotateCcw,
		Scissors,
		Trash2,
		Wand2
	} from '@lucide/svelte';
	import { fly, scale } from 'svelte/transition';
	import { neutralActionButton, primaryActionButton } from '$lib/constants/styles';
	import type { SketchState } from '$lib/sketch/state.svelte';

	type Props = {
		sketch: SketchState;
		class?: string;
	};
	let { sketch, class: extraClass = '' }: Props = $props();
</script>

<!--
	StageActions — the contextual CTA strip. Swaps its content per phase
	(editing → routing → routed). The pill is `inline-grid` so it sizes
	to its content rather than holding a fixed width — ~120 px during
	the single-button routing state, ~360 px when the three-button
	routed state lands. Width changes between phases are animated with
	`transition-[width]` so the morph at the end of the out-transition
	reads as part of the cross-fade rather than a snap.

	Both keyed contents are pinned to `col-start-1 row-start-1`, so
	they share the same grid cell and stack on top of each other.
	During the cross-fade, the cell width = max(old, new), so the
	parent grid never lays out the union of both button sets — killing
	the "two panels rendered together" artifact that plain flex
	stacking would produce (parent briefly laying out old 3 buttons
	+ new 3 buttons, snapping width to whichever survives).

	The cross-fade itself uses a small `y` offset: old content slides
	up and out, new content slides up and in, with a ~30 ms overlap
	where both are briefly visible at low opacity. The transition reads
	as a single "step" rather than a reflow.

	The Trim button uses an in-element scale transition so its
	appearance/disappearance when entering or leaving trim mode is
	smooth, separate from the larger phase swap.
-->
<section
	class="inline-grid min-h-[54px] w-fit max-w-[calc(100vw-36px)] rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 p-2 shadow-[0_18px_50px_rgb(27_26_23_/_0.20)] transition-[width] duration-200 ease-out max-[620px]:w-full {extraClass}"
	aria-label="Route actions"
>
	{#key sketch.phase}
		<div
			class="col-start-1 row-start-1 flex flex-wrap items-center gap-[7px]"
			in:fly={{ y: 5, duration: 220, delay: 60 }}
			out:fly={{ y: -5, duration: 90 }}
		>
			{#if sketch.phase === 'editing'}
				<button
					aria-label="Finish draft"
					class={neutralActionButton}
					disabled={!sketch.draft}
					onclick={() => sketch.finishDraft()}
					title="Finish shape (Esc / dblclick / right-click)"
					type="button"
				>
					<Check size={18} />
					<span>Finish</span>
				</button>
				<button
					aria-label="Clear all"
					class={neutralActionButton}
					disabled={!sketch.hasDrawing}
					onclick={() => sketch.clearDrawing()}
					title="Clear all — remove the sketch and any route"
					type="button"
				>
					<Trash2 size={18} />
					<span>Clear all</span>
				</button>
				<button
					aria-label="Route"
					class={primaryActionButton}
					disabled={!sketch.canRoute}
					onclick={() => sketch.createRoute()}
					title="Route along your sketch"
					type="button"
				>
					<Wand2 size={18} />
					<span>Route</span>
				</button>
			{:else if sketch.phase === 'routing'}
				<button
					aria-label="Routing"
					class={primaryActionButton}
					disabled
					title="Routing the route"
					type="button"
				>
					<span class="animate-spin"><LoaderCircle size={18} /></span>
					<span>Routing…</span>
				</button>
			{:else}
				{#if !sketch.trimMode}
					<button
						aria-label="Trim route"
						class={neutralActionButton}
						disabled={!sketch.routedPath || sketch.routedPath.length < 2}
						onclick={() => sketch.startTrim()}
						title="Trim a stretch of the route"
						type="button"
						transition:scale={{ duration: 160, start: 0.9 }}
					>
						<Scissors size={18} />
						<span>Trim</span>
					</button>
				{/if}
				<button
					aria-label="Edit sketch"
					class={neutralActionButton}
					onclick={() => sketch.backToEditing()}
					title="Edit sketch — drop the route and keep the drawing"
					type="button"
				>
					<RotateCcw size={18} />
					<span>Edit sketch</span>
				</button>
				<button
					aria-label="Export GPX"
					class={primaryActionButton}
					onclick={() => sketch.downloadGpx()}
					title="Export the route as GPX"
					type="button"
				>
					<Download size={18} />
					<span>Export GPX</span>
				</button>
			{/if}
		</div>
	{/key}
</section>
