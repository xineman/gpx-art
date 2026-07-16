<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { useMap } from '$lib/map/context';
	import { drawings } from '$lib/state/drawings.svelte';
	import { route } from '$lib/state/route.svelte';
	import { ROUTE_SOURCE, ensureRouteLayers, setSourceData } from '$lib/drawing/layers';

	const mapHandle = useMap();

	let boundMap: MaplibreMap | null = null;
	let loadHandler: (() => void) | null = null;

	function teardown() {
		if (boundMap && loadHandler) {
			boundMap.off('load', loadHandler);
		}
		loadHandler = null;
		boundMap = null;
	}

	function attachTo(map: MaplibreMap) {
		if (boundMap === map) return;
		teardown();
		boundMap = map;

		const setup = () => {
			if (boundMap !== map) return;
			ensureRouteLayers(map);
			setSourceData(map, ROUTE_SOURCE, route.collection);
		};

		if (map.isStyleLoaded()) {
			setup();
		} else {
			loadHandler = setup;
			map.once('load', setup);
		}
	}

	// Bind when Map.svelte publishes the instance.
	$effect(() => {
		const map = mapHandle.current;
		if (map) attachTo(map);
		else teardown();
	});

	// Push route geometry into the map source.
	$effect(() => {
		const map = boundMap;
		const data = route.collection;
		if (map?.getSource(ROUTE_SOURCE)) {
			setSourceData(map, ROUTE_SOURCE, data);
		}
	});

	// Invalidate derived route when the sketch changes.
	$effect(() => {
		route.syncSketch(drawings.revision);
	});

	onDestroy(teardown);
</script>
