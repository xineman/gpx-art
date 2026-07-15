<script lang="ts">
	import { onMount } from 'svelte';
	import Map from './Map.svelte';
	import DrawingLayer from './DrawingLayer.svelte';
	import HistoryPanel from '$lib/components/history/HistoryPanel.svelte';
	import StatusBar from '$lib/components/status/StatusBar.svelte';
	import ToolsPanel from '$lib/components/tools/ToolsPanel.svelte';
	import ToolShortcuts from '$lib/components/tools/ToolShortcuts.svelte';
	import { MAP_STYLE_URL, WARSAW_BOUNDS, WARSAW_CENTER, WARSAW_ZOOM } from '$lib/config/map';
	import { pointer } from '$lib/util/pointer.svelte';

	interface Props {
		center?: [number, number];
		zoom?: number;
		bounds?: [[number, number], [number, number]];
		style?: string;
	}

	let {
		center = WARSAW_CENTER,
		zoom = WARSAW_ZOOM,
		bounds = WARSAW_BOUNDS,
		style = MAP_STYLE_URL
	}: Props = $props();

	/** Mirrors Map `ready` — loader vs panels until style + first paint. */
	let mapReady = $state(false);

	onMount(() => {
		pointer.init();
	});
</script>

<ToolShortcuts />

<div class="fixed inset-0 m-0 h-dvh w-screen overflow-hidden p-0">
	<Map {center} {zoom} {bounds} {style} bind:ready={mapReady}>
		<DrawingLayer />
	</Map>

	{#if mapReady}
		<!-- Top-left stack: status + desktop tools. Safe-area aware for notched devices. -->
		<div
			class="pointer-events-none absolute top-[max(1.125rem,env(safe-area-inset-top))] left-[max(1.125rem,env(safe-area-inset-left))] z-2 flex flex-col items-start gap-3.5 max-[620px]:right-[max(0.75rem,env(safe-area-inset-right))] max-[620px]:left-[max(0.75rem,env(safe-area-inset-left))]"
		>
			<div class="pointer-events-auto max-[620px]:w-full">
				<StatusBar />
			</div>
			<div class="pointer-events-auto max-[620px]:hidden">
				<ToolsPanel layout="desktop" />
			</div>
		</div>

		<!-- Mobile: centered content-hugging dock (not edge-to-edge). -->
		<div
			class="pointer-events-none absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-2 hidden justify-center px-3 max-[620px]:flex"
		>
			<div class="pointer-events-auto">
				<ToolsPanel layout="mobile" />
			</div>
		</div>

		<!-- Bottom-left: undo/redo. Stays clear of the centered mobile tools dock. -->
		<div
			class="pointer-events-none absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(1.125rem,env(safe-area-inset-left))] z-2 max-[620px]:left-[max(0.75rem,env(safe-area-inset-left))]"
		>
			<div class="pointer-events-auto">
				<HistoryPanel />
			</div>
		</div>
	{:else}
		<div
			class="pointer-events-none absolute inset-0 z-1 flex flex-col items-center justify-center gap-3 bg-canvas"
			aria-hidden="true"
		>
			<div
				class="h-8 w-8 animate-spin rounded-full border-2 border-ink-muted/25 border-t-blaze"
			></div>
			<p class="font-mono text-[10px] font-medium tracking-[0.18em] text-ink-muted uppercase">
				Loading map
			</p>
		</div>
	{/if}
</div>
