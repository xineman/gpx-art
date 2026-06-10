<script lang="ts">
	import { Check, Download, Eraser, LoaderCircle, RotateCcw, Trash2, Undo2 } from '@lucide/svelte';
	import { neutralActionButton, primaryActionButton } from '$lib/constants/styles';
	import type { SketchState } from '$lib/sketch/state.svelte';

	type Props = {
		state: SketchState;
		class?: string;
	};
	let { state, class: extraClass = '' }: Props = $props();
</script>

<section
	class="flex max-w-[calc(100vw-36px)] flex-wrap items-center gap-[7px] rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 p-2 shadow-[0_18px_50px_rgb(27_26_23_/_0.20)] max-[620px]:w-full {extraClass}"
	aria-label="Route actions"
>
	<button
		aria-label="Finish"
		class={neutralActionButton}
		disabled={state.phase !== 'editing' || !state.draft}
		onclick={() => state.finishDraft()}
		title="Finish shape"
		type="button"
	>
		<Check size={18} />
		<span>Finish</span>
	</button>
	<button
		aria-label="Undo"
		class={neutralActionButton}
		disabled={state.phase === 'routing' || state.undoStack.length === 0}
		onclick={() => state.undo()}
		title="Undo"
		type="button"
	>
		<Undo2 size={18} />
		<span>Undo</span>
	</button>
	<button
		aria-label="Redo"
		class={neutralActionButton}
		disabled={state.phase === 'routing' || state.redoStack.length === 0}
		onclick={() => state.redo()}
		title="Redo"
		type="button"
	>
		<RotateCcw size={18} style="transform: scaleX(-1);" />
		<span>Redo</span>
	</button>
	<button
		aria-label="Clear"
		class={neutralActionButton}
		disabled={state.phase !== 'editing' || !state.hasDrawing}
		onclick={() => state.clearDrawing()}
		title="Clear"
		type="button"
	>
		<Trash2 size={18} />
		<span>Clear</span>
	</button>
	{#if state.phase === 'routed'}
		<button
			aria-label="Export GPX"
			class={primaryActionButton}
			onclick={() => state.downloadGpx()}
			title="Export GPX"
			type="button"
		>
			<Download size={18} />
			<span>GPX</span>
		</button>
		<button
			aria-label="Edit sketch"
			class={neutralActionButton}
			onclick={() => state.backToEditing()}
			title="Edit sketch"
			type="button"
		>
			<RotateCcw size={18} />
			<span>Edit</span>
		</button>
	{:else}
		<button
			aria-label="Route"
			class={primaryActionButton}
			disabled={!state.canRoute || state.phase === 'routing'}
			onclick={() => state.createRoute()}
			title="Route"
			type="button"
		>
			{#if state.phase === 'routing'}
				<span class="animate-spin"><LoaderCircle size={18} /></span>
			{:else}
				<Eraser size={18} />
			{/if}
			<span>{state.phase === 'routing' ? 'Routing' : 'Route'}</span>
		</button>
	{/if}
</section>
