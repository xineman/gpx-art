import type { Feature, FeatureCollection, Geometry } from 'geojson';

export type DrawingFeature = Feature<Geometry, { tool: string; id: string }>;

/**
 * Completed drawings as a GeoJSON FeatureCollection.
 * DrawingLayer keeps MapLibre sources in sync with this list.
 */
let features = $state<DrawingFeature[]>([]);

export const drawings = {
	get features() {
		return features;
	},
	get collection(): FeatureCollection {
		return {
			type: 'FeatureCollection',
			features
		};
	},
	add(geometry: Geometry, tool: string) {
		const id = crypto.randomUUID();
		const feature: DrawingFeature = {
			type: 'Feature',
			id,
			properties: { tool, id },
			geometry
		};
		features = [...features, feature];
		return feature;
	},
	clear() {
		features = [];
	},
	remove(id: string) {
		features = features.filter((f) => f.properties.id !== id);
	}
};
