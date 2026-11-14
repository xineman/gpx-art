import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl';

export const EMPTY_FEATURE_COLLECTION: FeatureCollection = {
	type: 'FeatureCollection',
	features: []
};

export function setSourceData(map: MaplibreMap, sourceId: string, data: FeatureCollection) {
	const source = map.getSource(sourceId) as GeoJSONSource | undefined;
	source?.setData(data);
}
