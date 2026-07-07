<script lang="ts">
	import { Check, Download, Eraser, LoaderCircle, RotateCcw, Trash2, Undo2 } from '@lucide/svelte';
	import { neutralActionButton, primaryActionButton } from '$lib/constants/styles';
	import FileMenu from './FileMenu.svelte';
	import type { SketchState } from '$lib/sketch/state.svelte';

	type Props = {
		sketch: SketchState;
		class?: string;
	};
	let { sketch, class: extraClass = '' }: Props = $props();
</script>

<section
	class="flex max-w-[calc(100vw-36px)] flex-wrap items-center gap-[7px] rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 p-2 shadow-[0_18px_50px_rgb(27_26_23_/_0.20)] max-[620px]:w-full {extraClass}"
	aria-label="Route actions"
>
	<button
		aria-label="Finish"
		class={neutralActionButton}
		disabled={sketch.phase !== 'editing' || !sketch.draft}
		onclick={() => sketch.finishDraft()}
		title="Finish shape"
		type="button"
	>
		<Check size={18} />
		<span>Finish</span>
	</button>
	<button
		aria-label="Undo"
		class={neutralActionButton}
		disabled={sketch.phase === 'routing' || sketch.undoStack.length === 0}
		onclick={() => sketch.undo()}
		title="Undo"
		type="button"
	>
		<Undo2 size={18} />
		<span>Undo</span>
	</button>
	<button
		aria-label="Redo"
		class={neutralActionButton}
		disabled={sketch.phase === 'routing' || sketch.redoStack.length === 0}
		onclick={() => sketch.redo()}
		title="Redo"
		type="button"
	>
		<RotateCcw size={18} style="transform: scaleX(-1);" />
		<span>Redo</span>
	</button>
	<button
		aria-label="Clear"
		class={neutralActionButton}
		disabled={sketch.phase !== 'editing' || !sketch.hasDrawing}
		onclick={() => sketch.clearDrawing()}
		title="Clear"
		type="button"
	>
		<Trash2 size={18} />
		<span>Clear</span>
	</button>
	<FileMenu {sketch} />
	{#if sketch.phase === 'routed'}
		<button
			aria-label="Export GPX"
			class={primaryActionButton}
			onclick={() => sketch.downloadGpx()}
			title="Export GPX"
			type="button"
		>
			<Download size={18} />
			<span>GPX</span>
		</button>
		<button
			aria-label="Edit sketch"
			class={neutralActionButton}
			onclick={() => sketch.backToEditing()}
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
			disabled={!sketch.canRoute || sketch.phase === 'routing'}
			onclick={() => sketch.createRoute()}
			title="Route"
			type="button"
		>
			{#if sketch.phase === 'routing'}
				<span class="animate-spin"><LoaderCircle size={18} /></span>
			{:else}
				<Eraser size={18} />
			{/if}
			<span>{sketch.phase === 'routing' ? 'Routing' : 'Route'}</span>
		</button>
	{/if}
</section>
