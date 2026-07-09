import type * as Leaflet from 'leaflet';
import { ROUTE_COLOR } from '$lib/constants/routing';
import { closeShape, toLatLngs } from '$lib/geometry/point';
import type { Point, Shape } from '$lib/types/sketch';
import type { RouteDebugBatch } from '$lib/routing/batchPlan';
import { renderRouteDebug } from './route-debug-layer';
import {
	CHEVRON_SIZE_PX,
	DEFAULT_CHEVRON_OPTIONS,
	chevronVertices,
	placeChevronsAlongPath
} from './route-direction';

type L = typeof import('leaflet');
type VertexMoveHandler = (
	shapeId: string,
	pointIndex: number,
	point: Point,
	isDraft: boolean
) => void;
type TrimHandleMoveHandler = (which: 'start' | 'end', point: Point) => void;

// Tools where we keep committed-shape vertex markers visible. When the current
// tool matches a shape's type, we hide its markers so clicking near an
// existing corner starts a fresh shape instead of dragging the existing one.
type Edits = (shape: Shape) => boolean;

// Trim-mode colors. Chosen to read as a deliberate "red-pen correction" on
// the cream canvas and aerial tiles, distinct from the orange draft stroke
// and the blue routed polyline. Warm vermilion (#c8412c) for the cut marks,
// soft salmon for the dashed overlay so it reads as "ghosted" rather than
// a hard stroke. Trim-handle ink matches the rest of the dark ink palette.
const TRIM_RED = '#c8412c';
const TRIM_RED_SOFT = '#f6c5b8';
const TRIM_HANDLE_FILL = '#fff7df';

// Route direction chrome. Cream fill matches vertex / trim handles so the
// start anchor and chevron fill read as the same "ink on cream" vocabulary
// as the rest of the map chrome; stroke stays route blue.
const ROUTE_HANDLE_FILL = '#fff7df';
const CHEVRON_STROKE_WEIGHT = 2.5;

export function renderLayers(
	L: L | undefined,
	map: Leaflet.Map | undefined,
	drawingLayer: Leaflet.LayerGroup | undefined,
	shapes: Shape[],
	draft: Shape | null,
	onVertexMove?: VertexMoveHandler,
	canEditCommitted: Edits = () => false,
	routeLayer?: Leaflet.LayerGroup,
	routedPath?: Point[] | null,
	trimMode: boolean = false,
	trimStart: number | null = null,
	trimEnd: number | null = null,
	onTrimHandleDrop?: TrimHandleMoveHandler,
	debugLayer?: Leaflet.LayerGroup,
	routeDebugBatches: readonly RouteDebugBatch[] = []
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
			addRouteLayer(L, map, routeLayer, routedPath, trimMode, trimStart, trimEnd, onTrimHandleDrop);
		}
	}

	if (debugLayer) {
		debugLayer.clearLayers();
		if (routeDebugBatches.length > 0) {
			renderRouteDebug(L, debugLayer, routeDebugBatches);
		}
	}
}

// Render the road-snapped route as a single thick polyline. The route layer is
// independent of the drawing layer so subsequent renders of shapes (e.g. while
// editing) don't wipe the route — the user can see their sketch and the
// generated route side-by-side.
//
// Direction chrome (always, when not in trim mode):
//   - start / end anchors so ride order is obvious on loops;
//   - open V chevrons spaced in *screen* pixels along the path (recomputed
//     on zoom via the map's zoomend → render path).
//
// In trim mode, mid-route chevrons are suppressed so they don't compete with
// the red-pen cut UI. Start/end anchors stay so the overall ride order remains
// readable while picking cuts. Additionally draws:
//   - a dashed red overlay polyline over the marked span (so the user
//     sees exactly which stretch is going to disappear on Confirm);
//   - one or two cut handles (cream-filled circleMarkers with red stroke)
//     at trimStart / trimEnd. The handles are draggable via
//     makeTrimHandleDraggable so the user can refine a pick without
//     re-clicking on the polyline.
function addRouteLayer(
	L: L,
	map: Leaflet.Map | undefined,
	routeLayer: Leaflet.LayerGroup,
	routedPath: Point[],
	trimMode: boolean,
	trimStart: number | null,
	trimEnd: number | null,
	onTrimHandleDrop?: TrimHandleMoveHandler
) {
	L.polyline(toLatLngs(routedPath), {
		interactive: false,
		color: ROUTE_COLOR,
		weight: 5,
		opacity: 0.9,
		lineCap: 'round',
		lineJoin: 'round'
	}).addTo(routeLayer);

	// Start / end stay visible in trim mode; chevrons only when the full
	// route is the focus (not mid-cut).
	addRouteEndpoints(L, routeLayer, routedPath);
	if (!trimMode && map) {
		addRouteChevrons(L, map, routeLayer, routedPath);
	}

	if (!trimMode) return;

	// Overlay polyline: visible only when both picks are set and they
	// describe a non-trivial span (>=2 points). The slice uses the
	// routedPath entries directly — no simplification — so the overlay
	// tracks the exact path the cut will remove.
	if (trimStart !== null && trimEnd !== null) {
		const lo = Math.min(trimStart, trimEnd);
		const hi = Math.max(trimStart, trimEnd);
		if (hi - lo >= 1) {
			const overlay = routedPath.slice(lo, hi + 1);
			// Soft ghosted backdrop behind the dashed red line so the
			// marked span reads at a glance even on a busy blue polyline.
			L.polyline(toLatLngs(overlay), {
				interactive: false,
				color: TRIM_RED_SOFT,
				weight: 12,
				opacity: 0.55,
				lineCap: 'round',
				lineJoin: 'round'
			}).addTo(routeLayer);
			L.polyline(toLatLngs(overlay), {
				interactive: false,
				color: TRIM_RED,
				weight: 5,
				opacity: 0.95,
				dashArray: '7 6',
				lineCap: 'butt',
				lineJoin: 'round'
			}).addTo(routeLayer);
		}
	}

	if (trimStart !== null) {
		addTrimHandle(L, map, routeLayer, routedPath[trimStart], 'start', onTrimHandleDrop);
	}
	if (trimEnd !== null && trimEnd !== trimStart) {
		addTrimHandle(L, map, routeLayer, routedPath[trimEnd], 'end', onTrimHandleDrop);
	}
}

// Distinct start (open cream disc) and end (filled blue disc) so a closed
// art shape still answers "which way do I ride this?". Non-interactive so
// they never steal trim picks or map pans.
function addRouteEndpoints(L: L, routeLayer: Leaflet.LayerGroup, routedPath: Point[]) {
	const start = routedPath[0];
	const end = routedPath[routedPath.length - 1];

	L.circleMarker([start.lat, start.lng], {
		interactive: false,
		color: ROUTE_COLOR,
		fillColor: ROUTE_HANDLE_FILL,
		fillOpacity: 1,
		radius: 6,
		weight: 3
	}).addTo(routeLayer);

	// Coincident start/end (true loops after stitching) — only draw one
	// start marker; the chevrons carry direction for the rest.
	const sameEndpoint =
		Math.abs(start.lat - end.lat) < 1e-9 && Math.abs(start.lng - end.lng) < 1e-9;
	if (sameEndpoint) return;

	L.circleMarker([end.lat, end.lng], {
		interactive: false,
		color: ROUTE_HANDLE_FILL,
		fillColor: ROUTE_COLOR,
		fillOpacity: 1,
		radius: 6,
		weight: 2.5
	}).addTo(routeLayer);
}

// Project the route into layer pixels, place screen-spaced chevrons, draw
// each as an open V polyline. Requires a live map for latLngToLayerPoint;
// callers already gate on map being defined.
//
// Viewport is the current map frame in layer pixels (padded) so the
// placement budget is spent on marks you can see — critical when zoomed
// in, where the full path may be tens of thousands of screen pixels long.
function addRouteChevrons(
	L: L,
	map: Leaflet.Map,
	routeLayer: Leaflet.LayerGroup,
	routedPath: Point[]
) {
	const screen = routedPath.map((pt) => {
		const lp = map.latLngToLayerPoint([pt.lat, pt.lng]);
		return { x: lp.x, y: lp.y };
	});

	const size = map.getSize();
	const pad = DEFAULT_CHEVRON_OPTIONS.spacing;
	const topLeft = map.containerPointToLayerPoint(L.point(-pad, -pad));
	const bottomRight = map.containerPointToLayerPoint(L.point(size.x + pad, size.y + pad));
	const viewport = {
		minX: Math.min(topLeft.x, bottomRight.x),
		minY: Math.min(topLeft.y, bottomRight.y),
		maxX: Math.max(topLeft.x, bottomRight.x),
		maxY: Math.max(topLeft.y, bottomRight.y)
	};

	const placements = placeChevronsAlongPath(screen, DEFAULT_CHEVRON_OPTIONS, viewport);
	for (const place of placements) {
		const verts = chevronVertices(place, place.angle, CHEVRON_SIZE_PX);
		const latlngs = verts.map((v) => {
			const ll = map.layerPointToLatLng(L.point(v.x, v.y));
			return [ll.lat, ll.lng] as [number, number];
		});

		// Soft cream understroke so the V stays legible on dark tiles /
		// busy OSM streets; blue top stroke matches the route.
		L.polyline(latlngs, {
			interactive: false,
			color: ROUTE_HANDLE_FILL,
			weight: CHEVRON_STROKE_WEIGHT + 2,
			opacity: 0.85,
			lineCap: 'round',
			lineJoin: 'round'
		}).addTo(routeLayer);
		L.polyline(latlngs, {
			interactive: false,
			color: ROUTE_COLOR,
			weight: CHEVRON_STROKE_WEIGHT,
			opacity: 0.95,
			lineCap: 'round',
			lineJoin: 'round'
		}).addTo(routeLayer);
	}
}

function addTrimHandle(
	L: L,
	map: Leaflet.Map | undefined,
	routeLayer: Leaflet.LayerGroup,
	point: Point,
	which: 'start' | 'end',
	onTrimHandleDrop?: TrimHandleMoveHandler
) {
	const marker = L.circleMarker([point.lat, point.lng], {
		color: TRIM_RED,
		fillColor: TRIM_HANDLE_FILL,
		fillOpacity: 1,
		radius: 7,
		weight: 3
	}).addTo(routeLayer);

	if (onTrimHandleDrop && map) {
		makeTrimHandleDraggable(L, marker, map, which, onTrimHandleDrop);
	}
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

// Like makeVertexDraggable, but for the trim cut handles. The visual
// marker follows the cursor freely during the drag — no snap-to-vertex
// mid-drag — so the user can place it precisely. Only on mouseup do we
// project the drop point back to the nearest routedPath vertex via the
// caller-supplied callback. This keeps the state updates to one per
// drop instead of one per pixel of cursor motion, which would otherwise
// thrash the dashed overlay polyline.
function makeTrimHandleDraggable(
	L: L,
	marker: Leaflet.CircleMarker,
	map: Leaflet.Map,
	which: 'start' | 'end',
	onDrop: TrimHandleMoveHandler
) {
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
	};

	const onMouseUp = () => {
		if (!armed) return;
		armed = false;
		map.dragging.enable();
		const final = marker.getLatLng();
		onDrop(which, { lat: final.lat, lng: final.lng });
		document.removeEventListener('mousemove', onMouseMove);
		document.removeEventListener('mouseup', onMouseUp);
	};

	document.addEventListener('mousemove', onMouseMove);
	document.addEventListener('mouseup', onMouseUp);
}
