<script lang="ts">
	import { onMount } from 'svelte';
	import type * as Leaflet from 'leaflet';
	import { SketchState } from '$lib/sketch/state.svelte';
	import { createMap } from '$lib/map/bootstrap';
	import ActionBar from '$lib/components/ActionBar.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import HistoryDock from '$lib/components/HistoryDock.svelte';
	import RouteDebugPanel from '$lib/components/RouteDebugPanel.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import ToolPalette from '$lib/components/ToolPalette.svelte';
	import TrimPanel from '$lib/components/TrimPanel.svelte';

	let mapElement: HTMLDivElement | undefined = $state();
	const sketch = new SketchState();
	let hoveredPanel = $state<string | null>(null);
	let mapHandle: { teardown: () => void } | null = null;

	// Test-only handle so Playwright can drive the trim flow without a
	// real OSRM round-trip. It is a passive reference — no behaviour
	// change for end users — but it does leak the full state object on
	// window. Acceptable for an offline-only app with no auth.
	if (typeof window !== 'undefined') {
		(window as unknown as { __gpxArtTest?: { sketch: SketchState } }).__gpxArtTest = { sketch };
	}

	// Cached panel wrapper elements. We hit-test these with getBoundingClientRect()
	// during a drag rather than relying on built-in DOM hit-testing, because our
	// panel wrappers carry pointer-events: none while isDragging is true (so
	// mousedown/mousemove fall through to the map). getBoundingClientRect() reports
	// the visual rect regardless of pointer-events.
	const panelElements: HTMLElement[] = [];

	onMount(() => {
		let cancelled = false;
		document.querySelectorAll('[data-panel]').forEach((el) => {
			panelElements.push(el as HTMLElement);
		});

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
				const x = original.clientX;
				const y = original.clientY;
				let found: string | null = null;
				for (const el of panelElements) {
					const rect = el.getBoundingClientRect();
					if (rect.width === 0 || rect.height === 0) continue;
					if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
						found = el.getAttribute('data-panel');
						break;
					}
				}
				hoveredPanel = found;
			});
		})();

		const onKeydown = (event: KeyboardEvent) => {
			sketch.handleKeydown(event);
		};
		const onKeyup = (event: KeyboardEvent) => sketch.handleKeyup(event);
		window.addEventListener('keydown', onKeydown);
		window.addEventListener('keyup', onKeyup);

		return () => {
			cancelled = true;
			window.removeEventListener('keydown', onKeydown);
			window.removeEventListener('keyup', onKeyup);
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
				class="transition-opacity duration-150"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'status'}
			>
				<StatusBar state={sketch} />
			</div>
			<div
				data-panel="palette"
				class="transition-opacity duration-150"
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
				class="transition-opacity duration-150"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'palette'}
			>
				<ToolPalette state={sketch} class="hidden max-[620px]:flex" />
			</div>
			<div
				data-panel="error"
				class="transition-opacity duration-150"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'error'}
			>
				<ErrorBanner error={sketch.routeError} />
			</div>
			<div
				data-panel="trim"
				class="transition-opacity duration-150"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'trim'}
			>
				<TrimPanel {sketch} />
			</div>
			<div
				data-panel="route-debug"
				class="transition-opacity duration-150"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'route-debug'}
			>
				<RouteDebugPanel {sketch} />
			</div>
			<div
				data-panel="history"
				class="transition-opacity duration-150"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'history'}
			>
				<HistoryDock {sketch} />
			</div>
			<div
				data-panel="action"
				class="transition-opacity duration-150"
				class:pointer-events-auto={!sketch.isDragging}
				class:pointer-events-none={sketch.isDragging}
				class:opacity-30={sketch.isDragging && hoveredPanel === 'action'}
			>
				<ActionBar {sketch} />
			</div>
		</div>
	</div>
</main>
