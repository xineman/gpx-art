<script lang="ts">
	import { RotateCcw, Undo2 } from '@lucide/svelte';
	import { neutralActionButton } from '$lib/constants/styles';
	import FileMenu from './FileMenu.svelte';
	import type { SketchState } from '$lib/sketch/state.svelte';

	type Props = {
		sketch: SketchState;
		class?: string;
	};
	let { sketch, class: extraClass = '' }: Props = $props();
</script>

<!--
	HistoryDock — the always-on utility strip. Lives above the StageActions
	pill and never changes shape, content, or position across phases. Its
	contents (Undo, Redo, File menu) are phase-orthogonal: history applies
	to whatever the sketch/route looked like a moment ago, regardless of
	what the user is doing now. Keeping it stable gives users a fixed
	visual anchor while the stage pill below it morphs.
-->
<section
	class="flex max-w-[calc(100vw-36px)] flex-wrap items-center gap-[7px] rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 p-2 shadow-[0_18px_50px_rgb(27_26_23_/_0.20)] max-[620px]:w-full {extraClass}"
	aria-label="History and file actions"
>
	<button
		aria-label="Undo"
		class={neutralActionButton}
		disabled={sketch.phase === 'routing' || sketch.undoStack.length === 0}
		onclick={() => sketch.undo()}
		title="Undo (Cmd/Ctrl+Z)"
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
		title="Redo (Cmd/Ctrl+Shift+Z)"
		type="button"
	>
		<RotateCcw size={18} style="transform: scaleX(-1);" />
		<span>Redo</span>
	</button>
	<FileMenu {sketch} />
</section>
