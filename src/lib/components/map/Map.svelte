<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { MAP_STYLE_URL } from '$lib/config/map';
	import { provideMap } from '$lib/map/context';

	interface Props {
		/** Map center as [lng, lat] */
		center?: [number, number];
		/** Initial zoom level (ignored when `bounds` is set) */
		zoom?: number;
		/** Fit the map to these bounds [sw, ne] on load */
		bounds?: [[number, number], [number, number]];
		/** MapLibre style URL */
		style?: string;
		/** Extra CSS classes for the container */
		class?: string;
		/** Show navigation controls */
		showNavigation?: boolean;
		/** Overlays that need map context (e.g. DrawingLayer) */
		children?: Snippet;
	}

	let {
		center = [0, 0],
		zoom = 2,
		bounds,
		style = MAP_STYLE_URL,
		class: className = '',
		showNavigation = true,
		children
	}: Props = $props();

	let container: HTMLDivElement | undefined = $state();
	let mapInstance = $state.raw<MaplibreMap | null>(null);

	provideMap({
		get current() {
			return mapInstance;
		}
	});

	// MapLibre uses browser APIs (WebGL, workers) — load only on the client
	onMount(() => {
		if (!container) return;

		let cancelled = false;
		let instance: MaplibreMap | undefined;

		void (async () => {
			const maplibregl = (await import('maplibre-gl')).default;
			await import('maplibre-gl/dist/maplibre-gl.css');

			if (cancelled || !container) return;

			instance = new maplibregl.Map({
				container,
				style,
				center,
				zoom,
				...(bounds
					? {
							bounds,
							fitBoundsOptions: { padding: 40 }
						}
					: {})
			});

			if (showNavigation) {
				instance.addControl(new maplibregl.NavigationControl(), 'top-right');
			}

			mapInstance = instance;
		})();

		return () => {
			cancelled = true;
			mapInstance = null;
			instance?.remove();
		};
	});
</script>

<div class="map-root relative h-full min-h-0 w-full {className}">
	<div
		bind:this={container}
		class="h-full min-h-0 w-full [&_.maplibregl-map]:h-full [&_.maplibregl-map]:w-full"
		role="application"
		aria-label="Interactive map"
	></div>
	{#if children}
		{@render children()}
	{/if}
</div>
