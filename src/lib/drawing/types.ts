import type { Feature, Geometry } from 'geojson';

export type DrawingFeature = Feature<Geometry, { tool: string }>;
export type ToolId = 'pencil' | 'polyline' | 'polygon' | 'rectangle' | 'pan';
