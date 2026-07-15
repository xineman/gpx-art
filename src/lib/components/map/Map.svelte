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
	/** True after style + first paint — used to hide the blank/WebGL flash */
	let mapReady = $state(false);

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
				mapReady = true;
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
			mapReady = false;
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
		style:opacity={mapReady ? 1 : 0}
		role="application"
		aria-label="Interactive map"
		aria-busy={!mapReady}
	></div>

	{#if !mapReady}
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

	{#if children}
		{@render children()}
	{/if}
</div>
