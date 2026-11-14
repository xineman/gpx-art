<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
	import { useMap } from '#lib/map/context.js';
	import { route } from '../route.svelte';
	import { flash } from '#lib/util/flash.svelte.js';
	import { pointer } from '#lib/util/pointer.svelte.js';
	import { routeWaypointAtPoint } from '../map/waypoint-hit';
	import { ROUTE_SOURCE, ensureRouteLayers } from '../map/layers';
	import { setSourceData } from '#lib/map/sources.js';

	interface Props {
		/** Canvas cursor to restore after leaving a waypoint. */
		idleCursor: string;
	}

	let { idleCursor }: Props = $props();

	const mapHandle = useMap();

	let boundMap: MaplibreMap | null = null;
	let loadHandler: (() => void) | null = null;
	let hoveringWaypointIndex = $state<number | null>(null);

	function restoreToolCursor(map: MaplibreMap) {
		map.getCanvas().style.cursor = idleCursor;
	}

	function clearWaypointHover(map: MaplibreMap | null) {
		if (hoveringWaypointIndex === null) return;
		hoveringWaypointIndex = null;
		route.clearMoveWaypointFocus();
		if (map) restoreToolCursor(map);
	}

	function onMapMouseMove(event: MapMouseEvent) {
		const map = boundMap;
		if (!map || !pointer.fineHover) return;
		const nextIndex = route.isReady ? routeWaypointAtPoint(map, event.point) : null;
		if (nextIndex === hoveringWaypointIndex) return;
		if (nextIndex === null) {
			clearWaypointHover(map);
			return;
		}
		hoveringWaypointIndex = nextIndex;
		route.inspectMoveWaypoint(nextIndex);
		map.getCanvas().style.cursor = 'pointer';
	}

	function onMapMouseLeave() {
		if (!pointer.fineHover) return;
		clearWaypointHover(boundMap);
	}

	function onMapClick(event: MapMouseEvent) {
		const map = boundMap;
		if (!map || !route.isReady) return;
		const waypointIndex = routeWaypointAtPoint(map, event.point);
		if (waypointIndex == null) return;
		event.preventDefault();
		const result = route.cycleWaypointAction(waypointIndex);
		if (result) {
			const message =
				result === 'move'
					? 'Move waypoint selected · proposed position shown'
					: result === 'remove'
						? 'Remove waypoint selected'
						: 'Waypoint kept';
			const keepMinimum = route.pendingWaypointCount > 0 && !route.canRefineRoute;
			flash.show(
				keepMinimum ? `${message} · keep at least 2 waypoints to refine the route.` : `${message}.`
			);
		}
	}

	function teardown() {
		if (boundMap) {
			if (loadHandler) boundMap.off('load', loadHandler);
			boundMap.off('mousemove', onMapMouseMove);
			boundMap.off('mouseleave', onMapMouseLeave);
			boundMap.off('click', onMapClick);
			clearWaypointHover(boundMap);
		}
		hoveringWaypointIndex = null;
		loadHandler = null;
		boundMap = null;
	}

	function attachTo(map: MaplibreMap) {
		if (boundMap === map) return;
		teardown();
		boundMap = map;
		map.on('mousemove', onMapMouseMove);
		map.on('mouseleave', onMapMouseLeave);
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
		if (!ready && map && hoveringWaypointIndex != null) {
			clearWaypointHover(map);
		}
	});

	onDestroy(teardown);
</script>
