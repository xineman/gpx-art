<script lang="ts">
	import PanelChrome from '#lib/components/ui/PanelChrome.svelte';
	import ClearSketchButton from '#lib/drawing/components/ClearSketchButton.svelte';
	import DownloadGpxButton from '#lib/routing/components/DownloadGpxButton.svelte';
	import DrawingIOMenu from '#lib/drawing/components/DrawingIOMenu.svelte';
	import HistoryButtons from '#lib/drawing/components/HistoryButtons.svelte';
	import MoveReviewControls from '#lib/routing/components/MoveReviewControls.svelte';
	import RouteButton from '#lib/routing/components/RouteButton.svelte';
</script>

<div class="relative inline-flex">
	<MoveReviewControls />
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
</div>
