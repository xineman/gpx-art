<script lang="ts">
	import Map from './Map.svelte';
	import { MAP_STYLE_URL, WARSAW_BOUNDS, WARSAW_CENTER, WARSAW_ZOOM } from '$lib/config/map';

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
</script>

<div class="fixed inset-0 m-0 h-dvh w-screen overflow-hidden p-0">
	<Map {center} {zoom} {bounds} {style} />
</div>
