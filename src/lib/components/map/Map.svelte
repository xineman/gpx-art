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
		/**
		 * True after style + first paint. Bindable so parents own loading chrome
		 * (loader, panels) until the map is ready.
		 */
		ready?: boolean;
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
		ready = $bindable(false),
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

			const reveal = () => {
				if (cancelled) return;
				ready = true;
			};

			// `load` = style ready + first idle; covers the long style/tile gap
			if (instance.loaded()) {
				reveal();
			} else {
				instance.once('load', reveal);
			}

			mapInstance = instance;
		})();

		return () => {
			cancelled = true;
			ready = false;
			mapInstance = null;
			instance?.remove();
		};
	});
</script>

<div class="map-root relative h-full min-h-0 w-full bg-canvas {className}">
	<!-- class must stay static: reactive class rewrites wipe MapLibre's maplibregl-map -->
	<div
		bind:this={container}
		class="h-full min-h-0 w-full bg-canvas transition-opacity duration-300 ease-out"
		style:opacity={ready ? 1 : 0}
		role="application"
		aria-label="Interactive map"
		aria-busy={!ready}
	></div>

	{#if children}
		{@render children()}
	{/if}
</div>
