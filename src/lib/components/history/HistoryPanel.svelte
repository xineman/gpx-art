<script lang="ts">
	import PanelChrome from '$lib/components/ui/PanelChrome.svelte';
	import ClearSketchButton from './ClearSketchButton.svelte';
	import DownloadGpxButton from './DownloadGpxButton.svelte';
	import DrawingIOMenu from './DrawingIOMenu.svelte';
	import HistoryButtons from './HistoryButtons.svelte';
	import RouteButton from './RouteButton.svelte';
</script>

<PanelChrome label="Drawing actions">
	<HistoryButtons />

	<div class="mx-0.5 w-px self-stretch bg-panel-edge/20" aria-hidden="true"></div>

	<DrawingIOMenu />

	<div class="mx-0.5 w-px self-stretch bg-panel-edge/20" aria-hidden="true"></div>

	<ClearSketchButton />

	<div class="mx-0.5 w-px self-stretch bg-panel-edge/20" aria-hidden="true"></div>

	<DownloadGpxButton />

	<div class="mx-0.5 w-px self-stretch bg-panel-edge/20" aria-hidden="true"></div>

	<!-- Adaptive next step: sketch → route → iterative refinement. -->
	<RouteButton />
</PanelChrome>
