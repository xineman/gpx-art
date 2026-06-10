<script lang="ts">
	import { onMount } from 'svelte';
	import type * as Leaflet from 'leaflet';
	import { SketchState } from '$lib/sketch/state.svelte';
	import { createMap } from '$lib/map/bootstrap';
	import ActionBar from '$lib/components/ActionBar.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import ToolPalette from '$lib/components/ToolPalette.svelte';

	let mapElement: HTMLDivElement | undefined = $state();
	const sketch = new SketchState();
	let hoveredPanel = $state<string | null>(null);
	let mapHandle: { teardown: () => void } | null = null;

	onMount(() => {
		let cancelled = false;
		void (async () => {
			if (!mapElement) return;
			const handle = await createMap(mapElement, sketch);
			if (cancelled) {
				handle.teardown();
				return;
			}
			mapHandle = handle;
			sketch.attachMap(handle);
			handle.map.on('mousemove', (event: Leaflet.LeafletMouseEvent) => {
				if (!sketch.isDragging) {
					hoveredPanel = null;
					return;
				}
				const original = event.originalEvent as MouseEvent;
				const elements = document.elementsFromPoint(original.clientX, original.clientY);
				const panelEl = elements.find((el) => el.hasAttribute('data-panel'));
				hoveredPanel = panelEl ? panelEl.getAttribute('data-panel') : null;
			});
		})();

		const onKey = (event: KeyboardEvent) => sketch.handleKeydown(event);
		window.addEventListener('keydown', onKey);

		return () => {
			cancelled = true;
			window.removeEventListener('keydown', onKey);
			sketch.detachMap();
			mapHandle?.teardown();
			mapHandle = null;
		};
	});
</script>

<svelte:head>
	<title>GPX Art</title>
	<meta
		name="description"
		content="Draw a shape on a map, convert it to a rideable GPX route, and export it."
	/>
</svelte:head>

<main class="relative h-svh w-full overflow-hidden" data-phase={sketch.phase}>
	<div bind:this={mapElement} class="absolute inset-0 bg-[#d8d1ba]" aria-label="Drawing map"></div>
	<div
		class="pointer-events-none absolute inset-0 z-[500] flex flex-col items-start justify-between gap-[14px] p-[18px] max-[620px]:gap-[10px] max-[620px]:p-3"
	>
		<div class="flex flex-col items-start gap-[14px] max-[620px]:w-full">
			<div
				data-panel="status"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'status'}
			>
				<StatusBar state={sketch} />
			</div>
			<div
				data-panel="palette"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'palette'}
			>
				<ToolPalette state={sketch} class="max-[620px]:hidden" />
			</div>
		</div>
		<div class="flex flex-col items-start gap-[10px] max-[620px]:w-full">
			<div
				data-panel="palette"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'palette'}
			>
				<ToolPalette state={sketch} class="hidden max-[620px]:flex" />
			</div>
			<div
				data-panel="error"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'error'}
			>
				<ErrorBanner error={sketch.routeError} />
			</div>
			<div
				data-panel="action"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'action'}
			>
				<ActionBar state={sketch} />
			</div>
		</div>
	</div>
</main>
