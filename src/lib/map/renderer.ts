import type * as Leaflet from 'leaflet';
import { ROUTE_COLOR } from '$lib/constants/routing';
import { closeShape, toLatLngs } from '$lib/geometry/point';
import type { Point, Shape } from '$lib/types/sketch';

type L = typeof import('leaflet');
type VertexMoveHandler = (
	shapeId: string,
	pointIndex: number,
	point: Point,
	isDraft: boolean
) => void;

// Tools where we keep committed-shape vertex markers visible. When the current
// tool matches a shape's type, we hide its markers so clicking near an
// existing corner starts a fresh shape instead of dragging the existing one.
type Edits = (shape: Shape) => boolean;

export function renderLayers(
	L: L | undefined,
	map: Leaflet.Map | undefined,
	drawingLayer: Leaflet.LayerGroup | undefined,
	shapes: Shape[],
	draft: Shape | null,
	onVertexMove?: VertexMoveHandler,
	canEditCommitted: Edits = () => false,
	routeLayer?: Leaflet.LayerGroup,
	routedPath?: Point[] | null
) {
	if (!L || !drawingLayer) return;

	drawingLayer.clearLayers();

	for (const shape of shapes) {
		addShapeLayer(L, map, drawingLayer, shape, false, onVertexMove, canEditCommitted(shape));
	}

	if (draft) {
		addShapeLayer(L, map, drawingLayer, draft, true, onVertexMove, true);
	}

	if (routeLayer) {
		routeLayer.clearLayers();
		if (routedPath && routedPath.length >= 2) {
			addRouteLayer(L, routeLayer, routedPath);
		}
	}
}

// Render the road-snapped route as a single thick polyline. The route layer is
// independent of the drawing layer so subsequent renders of shapes (e.g. while
// editing) don't wipe the route — the user can see their sketch and the
// generated route side-by-side.
function addRouteLayer(L: L, routeLayer: Leaflet.LayerGroup, routedPath: Point[]) {
	L.polyline(toLatLngs(routedPath), {
		interactive: false,
		color: ROUTE_COLOR,
		weight: 5,
		opacity: 0.9,
		lineCap: 'round',
		lineJoin: 'round'
	}).addTo(routeLayer);
}

function addShapeLayer(
	L: L,
	map: Leaflet.Map | undefined,
	drawingLayer: Leaflet.LayerGroup,
	shape: Shape,
	isDraft: boolean,
	onVertexMove?: VertexMoveHandler,
	editable: boolean = false
) {
	if (shape.points.length === 0) return;

	const points =
		shape.type === 'polygon' || shape.type === 'rectangle'
			? closeShape(shape.points)
			: shape.points;
	const common = {
		interactive: false,
		lineCap: 'round' as const,
		lineJoin: 'round' as const,
		opacity: isDraft ? 0.92 : 0.72,
		weight: isDraft ? 4 : 3
	};

	if (shape.type === 'polygon' || shape.type === 'rectangle') {
		L.polygon(toLatLngs(points), {
			...common,
			color: isDraft ? '#f26b3a' : '#2c2924',
			fillColor: isDraft ? '#f26b3a' : '#e6b84a',
			fillOpacity: isDraft ? 0.15 : 0.1
		}).addTo(drawingLayer);
	} else {
		L.polyline(toLatLngs(points), {
			...common,
			color: isDraft ? '#f26b3a' : '#2c2924'
		}).addTo(drawingLayer);
	}

	if ((isDraft || editable) && shape.points.length > 0) {
		for (let i = 0; i < shape.points.length; i++) {
			const point = shape.points[i];
			const marker = L.circleMarker([point.lat, point.lng], {
				color: '#f26b3a',
				fillColor: '#fff7df',
				fillOpacity: 1,
				radius: 4,
				weight: 2
			}).addTo(drawingLayer);

			if (onVertexMove) {
				makeVertexDraggable(L, marker, map, shape.id, i, isDraft, onVertexMove);
			}
		}
	}
}

// Leaflet's circleMarker is interactive by default but not draggable. We attach
// a custom drag handler: mousedown arms it, document-level mousemove moves the
// marker + reports the new position back via onMove, document-level mouseup
// disarms. We also disable map dragging for the duration so Leaflet doesn't
// try to pan the map at the same time.
function makeVertexDraggable(
	L: L,
	marker: Leaflet.CircleMarker,
	map: Leaflet.Map | undefined,
	shapeId: string,
	pointIndex: number,
	isDraft: boolean,
	onMove: VertexMoveHandler
) {
	if (!map) return;

	let armed = false;

	marker.on('mousedown', (e: Leaflet.LeafletMouseEvent) => {
		L.DomEvent.stopPropagation(e);
		L.DomEvent.preventDefault(e.originalEvent);
		armed = true;
		map.dragging.disable();
	});

	const onMouseMove = (e: MouseEvent) => {
		if (!armed) return;
		const latLng = map.mouseEventToLatLng(e);
		marker.setLatLng(latLng);
		onMove(shapeId, pointIndex, { lat: latLng.lat, lng: latLng.lng }, isDraft);
	};

	const onMouseUp = () => {
		if (!armed) return;
		armed = false;
		map.dragging.enable();
		document.removeEventListener('mousemove', onMouseMove);
		document.removeEventListener('mouseup', onMouseUp);
	};

	document.addEventListener('mousemove', onMouseMove);
	document.addEventListener('mouseup', onMouseUp);
}
