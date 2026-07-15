<script lang="ts">
	import PanelChrome from '$lib/components/ui/PanelChrome.svelte';
	import ClearSketchButton from './ClearSketchButton.svelte';
	import DrawingIOMenu from './DrawingIOMenu.svelte';
	import HistoryButtons from './HistoryButtons.svelte';
</script>

<PanelChrome label="Drawing actions">
	<HistoryButtons />

	<div class="mx-0.5 w-px self-stretch bg-panel-edge/20" aria-hidden="true"></div>

	<DrawingIOMenu />

	<div class="mx-0.5 w-px self-stretch bg-panel-edge/20" aria-hidden="true"></div>

	<ClearSketchButton />
</PanelChrome>
