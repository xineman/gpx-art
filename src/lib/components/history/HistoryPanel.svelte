<script lang="ts">
	import ClearSketchButton from './ClearSketchButton.svelte';
	import DrawingIOMenu from './DrawingIOMenu.svelte';
	import HistoryButtons from './HistoryButtons.svelte';
</script>

<div
	class="inline-grid grid-flow-col auto-cols-max items-center gap-1 rounded-xl border border-panel-edge/20 bg-panel/95 p-2 shadow-panel backdrop-blur-sm"
	aria-label="Drawing actions"
	role="toolbar"
	aria-orientation="horizontal"
>
	<HistoryButtons />

	<div class="mx-0.5 w-px self-stretch bg-panel-edge/20" aria-hidden="true"></div>

	<DrawingIOMenu />

	<div class="mx-0.5 w-px self-stretch bg-panel-edge/20" aria-hidden="true"></div>

	<ClearSketchButton />
</div>
