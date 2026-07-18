import { getContext, setContext } from 'svelte';
import type { Map as MaplibreMap } from 'maplibre-gl';

const MAP_KEY = Symbol('maplibre-map');

export type MapHandle = {
	/** Reactive accessor — re-read after map loads. */
	readonly current: MaplibreMap | null;
};

export function provideMap(handle: MapHandle) {
	setContext(MAP_KEY, handle);
}

export function useMap(): MapHandle {
	const handle = getContext<MapHandle | undefined>(MAP_KEY);
	if (!handle) {
		throw new Error('useMap() requires a Map ancestor that called provideMap()');
	}
	return handle;
}
