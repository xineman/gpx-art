import type { Feature, FeatureCollection, Point as GeoJsonPoint } from 'geojson';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { ROUTE_COLOR } from '$lib/constants/routing';
import { closeShape } from '$lib/geometry/point';
import type { Point, Shape } from '$lib/types/sketch';
import type { RouteDebugBatch } from '$lib/routing/batchPlan';
import {
	emptyFeatureCollection,
	featureCollection,
	fromLngLat,
	lineFeature,
	pointFeature,
	polygonFeature,
	toLngLat
} from './coords';
import { buildRouteDebugCollection } from './route-debug-layer';
import {
	CHEVRON_SIZE_PX,
	DEFAULT_CHEVRON_OPTIONS,
	chevronVertices,
	placeChevronsAlongPath
} from './route-direction';
import { INTERACTIVE_LAYERS, LAYER, SOURCE, setSourceData } from './sources';

type VertexMoveHandler = (
	shapeId: string,
	pointIndex: number,
	point: Point,
	isDraft: boolean
) => void;
type TrimHandleMoveHandler = (which: 'start' | 'end', point: Point) => void;
type Edits = (shape: Shape) => boolean;

const TRIM_HANDLE_FILL = '#fff7df';
const ROUTE_HANDLE_FILL = '#fff7df';
const CHEVRON_STROKE_WEIGHT = 2.5;

type InteractionCallbacks = {
	onVertexMove?: VertexMoveHandler;
	onTrimHandleDrop?: TrimHandleMoveHandler;
};

let interactionCallbacks: InteractionCallbacks = {};
let interactionsBound = false;
/** After vertex/trim drag, ignore the synthetic click that follows mouseup. */
let suppressNextClick = false;
let activeVertexDrag: {
	shapeId: string;
	pointIndex: number;
	isDraft: boolean;
} | null = null;
let activeTrimDrag: {
	which: 'start' | 'end';
	point: Point;
} | null = null;

/**
 * Bind map-level drag for sketch vertices and trim handles once per map.
 * Call from bootstrap after layers exist. Callbacks are refreshed each render.
 */
export function bindMapInteractions(map: MapLibreMap) {
	if (interactionsBound) return;
	interactionsBound = true;

	map.on('mousedown', (e: MapMouseEvent) => {
		if (e.originalEvent.button !== 0) return;

		const features = map.queryRenderedFeatures(e.point, {
			layers: [...INTERACTIVE_LAYERS]
		});
		if (features.length === 0) return;

		const feature = features[0];
		const props = feature.properties ?? {};
		const layerId = feature.layer?.id;

		if (layerId === LAYER.routeHandles || layerId === LAYER.routeHandlesHit) {
			const which = props.which === 'end' ? 'end' : 'start';
			const coords = (feature.geometry as GeoJsonPoint).coordinates;
			activeTrimDrag = {
				which,
				point: fromLngLat(coords[0], coords[1])
			};
			e.preventDefault();
			map.dragPan.disable();
			attachDocumentDrag(map);
			return;
		}

		if (layerId === LAYER.sketchVertices || layerId === LAYER.sketchVerticesHit) {
			const shapeId = String(props.shapeId ?? '');
			const pointIndex = Number(props.pointIndex);
			if (!shapeId || !Number.isFinite(pointIndex)) return;
			const isDraft = props.isDraft === 1 || props.isDraft === true || props.isDraft === '1';
			activeVertexDrag = { shapeId, pointIndex, isDraft: Boolean(isDraft) };
			e.preventDefault();
			map.dragPan.disable();
			attachDocumentDrag(map);
		}
	});

	// Cursor feedback over interactive features
	map.on('mousemove', (e: MapMouseEvent) => {
		if (activeVertexDrag || activeTrimDrag) return;
		const features = map.queryRenderedFeatures(e.point, {
			layers: [...INTERACTIVE_LAYERS]
		});
		map.getCanvas().style.cursor = features.length > 0 ? 'grab' : '';
	});
}

function attachDocumentDrag(map: MapLibreMap) {
	const onMouseMove = (e: MouseEvent) => {
		const rect = map.getCanvas().getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const ll = map.unproject([x, y]);
		const point = fromLngLat(ll.lng, ll.lat);

		if (activeVertexDrag) {
			interactionCallbacks.onVertexMove?.(
				activeVertexDrag.shapeId,
				activeVertexDrag.pointIndex,
				point,
				activeVertexDrag.isDraft
			);
			return;
		}

		if (activeTrimDrag) {
			activeTrimDrag.point = point;
			// Preview: move only the dragged handle without thrashing full route state.
			setSourceData(
				map,
				SOURCE.routeHandles,
				featureCollection([pointFeature(point, { which: activeTrimDrag.which })])
			);
		}
	};

	const onMouseUp = () => {
		if (activeTrimDrag) {
			interactionCallbacks.onTrimHandleDrop?.(activeTrimDrag.which, activeTrimDrag.point);
		}
		if (activeVertexDrag || activeTrimDrag) {
			suppressNextClick = true;
		}
		activeVertexDrag = null;
		activeTrimDrag = null;
		map.dragPan.enable();
		document.removeEventListener('mousemove', onMouseMove);
		document.removeEventListener('mouseup', onMouseUp);
	};

	document.addEventListener('mousemove', onMouseMove);
	document.addEventListener('mouseup', onMouseUp);
}

/** True while a vertex or trim handle drag is in progress (map pan should stay off). */
export function isMapFeatureDragging(): boolean {
	return activeVertexDrag != null || activeTrimDrag != null;
}

/** Consume the post-drag click so line/polygon tools do not add a vertex. */
export function consumeSuppressedClick(): boolean {
	if (!suppressNextClick) return false;
	suppressNextClick = false;
	return true;
}

export function renderLayers(
	map: MapLibreMap | undefined,
	shapes: Shape[],
	draft: Shape | null,
	onVertexMove?: VertexMoveHandler,
	canEditCommitted: Edits = () => false,
	routedPath?: Point[] | null,
	trimMode: boolean = false,
	trimStart: number | null = null,
	trimEnd: number | null = null,
	onTrimHandleDrop?: TrimHandleMoveHandler,
	routeDebugBatches: readonly RouteDebugBatch[] = []
) {
	if (!map || !map.isStyleLoaded()) return;

	interactionCallbacks = { onVertexMove, onTrimHandleDrop };

	const fillFeatures: Feature[] = [];
	const lineFeatures: Feature[] = [];
	const vertexFeatures: Feature[] = [];

	const addShape = (shape: Shape, isDraft: boolean, editable: boolean) => {
		if (shape.points.length === 0) return;

		const points =
			shape.type === 'polygon' || shape.type === 'rectangle'
				? closeShape(shape.points)
				: shape.points;
		const draftFlag = isDraft ? 1 : 0;
		const props = { isDraft: draftFlag, shapeId: shape.id, shapeType: shape.type };

		if (shape.type === 'polygon' || shape.type === 'rectangle') {
			const poly = polygonFeature(points, props);
			if (poly) fillFeatures.push(poly);
			const outline = lineFeature(points, props);
			if (outline) lineFeatures.push(outline);
		} else {
			const line = lineFeature(points, props);
			if (line) lineFeatures.push(line);
		}

		if ((isDraft || editable) && shape.points.length > 0) {
			for (let i = 0; i < shape.points.length; i++) {
				vertexFeatures.push(
					pointFeature(shape.points[i], {
						shapeId: shape.id,
						pointIndex: i,
						isDraft: draftFlag
					})
				);
			}
		}
	};

	for (const shape of shapes) {
		addShape(shape, false, canEditCommitted(shape));
	}
	if (draft) {
		addShape(draft, true, true);
	}

	setSourceData(map, SOURCE.sketchFills, featureCollection(fillFeatures));
	setSourceData(map, SOURCE.sketchLines, featureCollection(lineFeatures));
	setSourceData(map, SOURCE.sketchVertices, featureCollection(vertexFeatures));

	// Route layers
	if (routedPath && routedPath.length >= 2) {
		const routeLine = lineFeature(routedPath, {});
		setSourceData(
			map,
			SOURCE.routeLine,
			routeLine ? featureCollection([routeLine]) : emptyFeatureCollection()
		);
		setSourceData(map, SOURCE.routeEndpoints, buildRouteEndpoints(routedPath));

		if (!trimMode) {
			setSourceData(map, SOURCE.routeChevrons, buildChevrons(map, routedPath));
		} else {
			setSourceData(map, SOURCE.routeChevrons, emptyFeatureCollection());
		}

		if (trimMode) {
			applyTrimOverlay(map, routedPath, trimStart, trimEnd);
			// Don't clobber live trim-handle preview mid-drag.
			if (!activeTrimDrag) {
				setSourceData(map, SOURCE.routeHandles, buildTrimHandles(routedPath, trimStart, trimEnd));
			}
		} else {
			setSourceData(map, SOURCE.routeTrimSoft, emptyFeatureCollection());
			setSourceData(map, SOURCE.routeTrimDash, emptyFeatureCollection());
			setSourceData(map, SOURCE.routeHandles, emptyFeatureCollection());
		}
	} else {
		setSourceData(map, SOURCE.routeLine, emptyFeatureCollection());
		setSourceData(map, SOURCE.routeEndpoints, emptyFeatureCollection());
		setSourceData(map, SOURCE.routeChevrons, emptyFeatureCollection());
		setSourceData(map, SOURCE.routeTrimSoft, emptyFeatureCollection());
		setSourceData(map, SOURCE.routeTrimDash, emptyFeatureCollection());
		setSourceData(map, SOURCE.routeHandles, emptyFeatureCollection());
	}

	if (routeDebugBatches.length > 0) {
		setSourceData(map, SOURCE.routeDebug, buildRouteDebugCollection(routeDebugBatches));
	} else {
		setSourceData(map, SOURCE.routeDebug, emptyFeatureCollection());
	}
}

function buildRouteEndpoints(routedPath: Point[]): FeatureCollection {
	const start = routedPath[0];
	const end = routedPath[routedPath.length - 1];
	const features: Feature[] = [
		pointFeature(start, {
			fill: ROUTE_HANDLE_FILL,
			stroke: ROUTE_COLOR,
			strokeWidth: 3,
			role: 'start'
		})
	];

	const sameEndpoint = Math.abs(start.lat - end.lat) < 1e-9 && Math.abs(start.lng - end.lng) < 1e-9;
	if (!sameEndpoint) {
		features.push(
			pointFeature(end, {
				fill: ROUTE_COLOR,
				stroke: ROUTE_HANDLE_FILL,
				strokeWidth: 2.5,
				role: 'end'
			})
		);
	}
	return featureCollection(features);
}

function buildChevrons(map: MapLibreMap, routedPath: Point[]): FeatureCollection {
	const screen = routedPath.map((pt) => {
		const p = map.project(toLngLat(pt));
		return { x: p.x, y: p.y };
	});

	const size = map.getContainer();
	const pad = DEFAULT_CHEVRON_OPTIONS.spacing;
	// Viewport in the same CSS-pixel space as map.project (y-down).
	const view = {
		minX: -pad,
		minY: -pad,
		maxX: size.clientWidth + pad,
		maxY: size.clientHeight + pad
	};

	const placements = placeChevronsAlongPath(screen, DEFAULT_CHEVRON_OPTIONS, view);
	const features: Feature[] = [];

	for (const place of placements) {
		const verts = chevronVertices(place, place.angle, CHEVRON_SIZE_PX);
		const points = verts.map((v) => {
			const ll = map.unproject([v.x, v.y]);
			return fromLngLat(ll.lng, ll.lat);
		});
		const line = lineFeature(points, { weight: CHEVRON_STROKE_WEIGHT });
		if (line) features.push(line);
	}

	return featureCollection(features);
}

function applyTrimOverlay(
	map: MapLibreMap,
	routedPath: Point[],
	trimStart: number | null,
	trimEnd: number | null
) {
	if (trimStart === null || trimEnd === null) {
		setSourceData(map, SOURCE.routeTrimSoft, emptyFeatureCollection());
		setSourceData(map, SOURCE.routeTrimDash, emptyFeatureCollection());
		return;
	}

	const lo = Math.min(trimStart, trimEnd);
	const hi = Math.max(trimStart, trimEnd);
	if (hi - lo < 1) {
		setSourceData(map, SOURCE.routeTrimSoft, emptyFeatureCollection());
		setSourceData(map, SOURCE.routeTrimDash, emptyFeatureCollection());
		return;
	}

	const overlay = routedPath.slice(lo, hi + 1);
	const soft = lineFeature(overlay, {});
	const dash = lineFeature(overlay, {});
	setSourceData(
		map,
		SOURCE.routeTrimSoft,
		soft ? featureCollection([soft]) : emptyFeatureCollection()
	);
	setSourceData(
		map,
		SOURCE.routeTrimDash,
		dash ? featureCollection([dash]) : emptyFeatureCollection()
	);
}

function buildTrimHandles(
	routedPath: Point[],
	trimStart: number | null,
	trimEnd: number | null
): FeatureCollection {
	const features: Feature[] = [];
	if (trimStart !== null && routedPath[trimStart]) {
		features.push(
			pointFeature(routedPath[trimStart], {
				which: 'start',
				fill: TRIM_HANDLE_FILL
			})
		);
	}
	if (trimEnd !== null && trimEnd !== trimStart && routedPath[trimEnd]) {
		features.push(
			pointFeature(routedPath[trimEnd], {
				which: 'end',
				fill: TRIM_HANDLE_FILL
			})
		);
	}
	return featureCollection(features);
}

/** Reset module interaction state (e.g. on map teardown). */
export function resetMapInteractions() {
	interactionsBound = false;
	activeVertexDrag = null;
	activeTrimDrag = null;
	suppressNextClick = false;
	interactionCallbacks = {};
}
