<script lang="ts">
	import { onMount } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { MAP_STYLE_URL } from '$lib/config/map';

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
	}

	let {
		center = [0, 0],
		zoom = 2,
		bounds,
		style = MAP_STYLE_URL,
		class: className = '',
		showNavigation = true
	}: Props = $props();

	let container: HTMLDivElement | undefined = $state();

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
		})();

		return () => {
			cancelled = true;
			instance?.remove();
		};
	});
</script>

<div
	bind:this={container}
	class="h-full min-h-0 w-full [&_.maplibregl-map]:h-full [&_.maplibregl-map]:w-full {className}"
	role="application"
	aria-label="Interactive map"
></div>
