<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Map as MaplibreMap, PointLike } from 'maplibre-gl';
	import { useMap } from '#lib/map/context.js';
	import { tools } from '../tools.svelte';
	import { drawings } from '../drawings.svelte';
	import { status } from '../status.svelte';
	import { DrawingController } from '../controller';
	import { isClosedLineString } from '../geo';
	import { DRAWINGS_SOURCE, ensureDrawingLayers } from '../map/layers';
	import { setSourceData } from '#lib/map/sources.js';

	let { ignorePoint }: { ignorePoint?: (map: MaplibreMap, point: PointLike) => boolean } = $props();
	const mapHandle = useMap();

	/** Reactive so tool-sync effects re-run once the map finishes loading. */
	let controller = $state.raw<DrawingController | null>(null);
	let boundMap: MaplibreMap | null = null;
	let loadHandler: (() => void) | null = null;

	function teardown() {
		if (boundMap && loadHandler) {
			boundMap.off('load', loadHandler);
		}
		loadHandler = null;
		controller?.detach();
		controller = null;
		boundMap = null;
	}

	function attachTo(map: MaplibreMap) {
		if (boundMap === map && controller) return;

		teardown();
		boundMap = map;

		const setup = () => {
			if (boundMap !== map) return;
			ensureDrawingLayers(map);
			setSourceData(map, DRAWINGS_SOURCE, drawings.collection);

			const c = new DrawingController(
				map,
				(geometry, tool) => {
					drawings.add(geometry, tool);
					status.announceCommit(tool, isClosedLineString(geometry));
				},
				(draft) => {
					if (!draft) status.setDraft(null);
					else
						status.setDraft(draft.tool, draft.geometry, {
							vertexCount: draft.vertexCount,
							canFinish: draft.canFinish
						});
				},
				(point) => ignorePoint?.(map, point) ?? false
			);
			c.attach();
			c.setTool(tools.active);
			c.setPanning(tools.isPanning);
			controller = c;
		};

		if (map.isStyleLoaded()) {
			setup();
		} else {
			loadHandler = setup;
			map.once('load', setup);
		}
	}

	// 1) Bind when Map.svelte publishes the map instance
	$effect(() => {
		const map = mapHandle.current;
		if (map) attachTo(map);
		else teardown();
	});

	// 2) Sticky tool from panel / letter shortcuts
	$effect(() => {
		const tool = tools.active;
		controller?.setTool(tool);
	});

	// 3) Space-to-pan + sticky pan (does not clear drafts)
	$effect(() => {
		const panning = tools.isPanning;
		controller?.setPanning(panning);
	});

	// 4) Push completed drawings into the GeoJSON source
	$effect(() => {
		const map = boundMap;
		const data = drawings.collection;
		if (map?.getSource(DRAWINGS_SOURCE)) {
			setSourceData(map, DRAWINGS_SOURCE, data);
		}
	});

	onDestroy(teardown);
</script>
