<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
	import { useMap } from '$lib/map/context';
	import { drawings } from '$lib/state/drawings.svelte';
	import { route } from '$lib/state/route.svelte';
	import { status } from '$lib/state/status.svelte';
	import { tools } from '$lib/state/tools.svelte';
	import { routeWaypointAtPoint } from '$lib/map/waypoint-hit';
	import { ROUTE_SOURCE, ensureRouteLayers, setSourceData } from '$lib/drawing/layers';

	const mapHandle = useMap();

	let boundMap: MaplibreMap | null = null;
	let loadHandler: (() => void) | null = null;
	let hoveringWaypoint = $state(false);

	function restoreToolCursor(map: MaplibreMap) {
		map.getCanvas().style.cursor = tools.isPanning ? 'grab' : 'crosshair';
	}

	function onMapMouseMove(event: MapMouseEvent) {
		const map = boundMap;
		if (!map) return;
		const nextHover = route.isReady && routeWaypointAtPoint(map, event.point) != null;
		if (nextHover === hoveringWaypoint) return;
		hoveringWaypoint = nextHover;
		if (nextHover) map.getCanvas().style.cursor = 'pointer';
		else restoreToolCursor(map);
	}

	function onMapClick(event: MapMouseEvent) {
		const map = boundMap;
		if (!map || !route.isReady) return;
		const waypointIndex = routeWaypointAtPoint(map, event.point);
		if (waypointIndex == null) return;
		event.preventDefault();
		const result = route.toggleDetourWaypoint(waypointIndex);
		if (result) {
			const keepMinimum = route.markedWaypointCount > 0 && !route.canRefineRoute;
			status.flash(
				keepMinimum
					? `Detour ${result} · keep at least 2 waypoints to refine the route.`
					: `Detour ${result}.`
			);
		}
	}

	function teardown() {
		if (boundMap) {
			if (loadHandler) boundMap.off('load', loadHandler);
			boundMap.off('mousemove', onMapMouseMove);
			boundMap.off('click', onMapClick);
			if (hoveringWaypoint) restoreToolCursor(boundMap);
		}
		hoveringWaypoint = false;
		loadHandler = null;
		boundMap = null;
	}

	function attachTo(map: MaplibreMap) {
		if (boundMap === map) return;
		teardown();
		boundMap = map;
		map.on('mousemove', onMapMouseMove);
		map.on('click', onMapClick);

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

	// Do not leave a stale pointer cursor when a ready route is cleared under it.
	$effect(() => {
		const ready = route.isReady;
		const map = boundMap;
		if (!ready && map && hoveringWaypoint) {
			hoveringWaypoint = false;
			restoreToolCursor(map);
		}
	});

	// Invalidate derived route when the sketch changes.
	$effect(() => {
		route.syncSketch(drawings.revision);
	});

	onDestroy(teardown);
</script>
