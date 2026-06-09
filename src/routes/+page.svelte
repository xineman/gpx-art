<script lang="ts">
	import {
		Check,
		Download,
		Eraser,
		Hand,
		LoaderCircle,
		MapPinned,
		Pencil,
		Pentagon,
		RotateCcw,
		Route,
		Square,
		Trash2,
		Undo2
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import 'leaflet/dist/leaflet.css';
	import type * as Leaflet from 'leaflet';

	type Point = { lat: number; lng: number };
	type Tool = 'pan' | 'pencil' | 'line' | 'polygon' | 'rectangle';
	type ShapeType = Exclude<Tool, 'pan'>;
	type Phase = 'editing' | 'routing' | 'routed';
	type Shape = {
		id: string;
		type: ShapeType;
		points: Point[];
	};
	type Snapshot = {
		draft: Shape | null;
		phase: Phase;
		route: Point[];
		routeDistance: number;
		shapes: Shape[];
	};

	const ROUTING_ENDPOINT = 'https://routing.openstreetmap.de/routed-bike/route/v1/driving';
	const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
	const TILE_ATTRIBUTION =
		'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
	const toolButtonBase =
		'inline-flex aspect-square w-[38px] cursor-pointer items-center justify-center rounded-md border-0 transition-[background,color,transform,opacity] duration-150 ease-in-out hover:bg-[#e6b84a] hover:text-[#1f1d19] disabled:cursor-not-allowed disabled:opacity-40 max-[620px]:w-full';
	const actionButtonBase =
		'inline-flex min-h-[38px] cursor-pointer items-center justify-center gap-[7px] rounded-md border-0 px-[11px] text-[13px] font-extrabold transition-[background,color,transform,opacity] duration-150 ease-in-out hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 max-[620px]:flex-auto max-[620px]:px-[9px]';
	const neutralActionButton = `${actionButtonBase} bg-[#efe1b9] text-[#2c2924] hover:bg-[#e6b84a]`;
	const primaryActionButton = `${actionButtonBase} bg-[#1e7d62] text-[#fff7df] hover:bg-[#155d49]`;

	let mapElement = $state<HTMLDivElement>();
	let currentTool = $state<Tool>('pencil');
	let phase = $state<Phase>('editing');
	let shapes = $state<Shape[]>([]);
	let draft = $state<Shape | null>(null);
	let undoStack = $state<Snapshot[]>([]);
	let route = $state<Point[]>([]);
	let routeDistance = $state(0);
	let status = $state('Sketch a shape, then route it.');
	let routeError = $state('');
	let dragOrigin = $state<Point | null>(null);

	let L: typeof import('leaflet') | undefined;
	let map: Leaflet.Map | undefined;
	let drawingLayer: Leaflet.LayerGroup | undefined;
	let routeLayer: Leaflet.LayerGroup | undefined;
	let activePencilShape: Shape | null = null;
	let activeRectangleShape: Shape | null = null;

	const canRoute = $derived(phase === 'editing' && routeInputPoints().length > 1);
	const hasDrawing = $derived(shapes.length > 0 || !!draft);
	const distanceLabel = $derived(routeDistance > 0 ? formatDistance(routeDistance) : '0 km');
	const pointLabel = $derived(
		route.length > 0 ? `${route.length} pts` : `${routeInputPoints().length} sketch pts`
	);

	onMount(() => {
		let disposed = false;

		async function initializeMap() {
			L = await import('leaflet');

			if (!mapElement || disposed || !L) return;

			map = L.map(mapElement, {
				center: [52.2297, 21.0122],
				doubleClickZoom: false,
				zoom: 12,
				zoomControl: false
			});

			L.control.zoom({ position: 'bottomright' }).addTo(map);
			L.tileLayer(TILE_URL, {
				attribution: TILE_ATTRIBUTION,
				maxZoom: 19
			}).addTo(map);

			drawingLayer = L.layerGroup().addTo(map);
			routeLayer = L.layerGroup().addTo(map);

			map.on('mousedown', handleMapMouseDown);
			map.on('mousemove', handleMapMouseMove);
			map.on('mouseup', handleMapMouseUp);
			map.on('click', handleMapClick);
			map.on('dblclick', finishDraft);
			map.on('contextmenu', finishDraft);
			window.addEventListener('keydown', handleKeydown);

			renderLayers();
		}

		void initializeMap();

		return () => {
			disposed = true;
			window.removeEventListener('keydown', handleKeydown);
			map?.remove();
		};
	});

	function setTool(tool: Tool) {
		if (phase !== 'editing') return;
		if (tool !== currentTool) {
			finishDraft();
			currentTool = tool;
			activePencilShape = null;
			activeRectangleShape = null;
			status = tool === 'pan' ? 'Map navigation active.' : `${toolName(tool)} ready.`;
		}
	}

	function toolButtonClass(tool: Tool) {
		return `${toolButtonBase} ${
			currentTool === tool ? 'bg-[#e6b84a] text-[#1f1d19]' : 'bg-transparent text-[#fff7df]'
		}`;
	}

	function handleMapMouseDown(event: Leaflet.LeafletMouseEvent) {
		if (!map || phase !== 'editing') return;

		if (currentTool === 'pencil') {
			event.originalEvent.preventDefault();
			map.dragging.disable();
			pushHistory();
			const firstPoint = toPoint(event.latlng);
			activePencilShape = {
				id: crypto.randomUUID(),
				points: [firstPoint],
				type: 'pencil'
			};
			shapes = [...shapes, activePencilShape];
			status = 'Drawing pencil stroke.';
			renderLayers();
		}

		if (currentTool === 'rectangle') {
			event.originalEvent.preventDefault();
			map.dragging.disable();
			pushHistory();
			const point = toPoint(event.latlng);
			dragOrigin = point;
			activeRectangleShape = {
				id: crypto.randomUUID(),
				points: rectanglePoints(point, point),
				type: 'rectangle'
			};
			shapes = [...shapes, activeRectangleShape];
			status = 'Sizing rectangle.';
			renderLayers();
		}
	}

	function handleMapMouseMove(event: Leaflet.LeafletMouseEvent) {
		if (phase !== 'editing') return;

		if (activePencilShape && currentTool === 'pencil') {
			const nextPoint = toPoint(event.latlng);
			const previous = activePencilShape.points.at(-1);
			if (!previous || distanceBetween(previous, nextPoint) > 8) {
				activePencilShape.points = [...activePencilShape.points, nextPoint];
				shapes = shapes.map((shape) =>
					shape.id === activePencilShape?.id ? activePencilShape : shape
				);
				renderLayers();
			}
		}

		if (activeRectangleShape && dragOrigin && currentTool === 'rectangle') {
			activeRectangleShape.points = rectanglePoints(dragOrigin, toPoint(event.latlng));
			shapes = shapes.map((shape) =>
				shape.id === activeRectangleShape?.id ? activeRectangleShape : shape
			);
			renderLayers();
		}
	}

	function handleMapMouseUp() {
		if (phase !== 'editing') return;

		if (activePencilShape) {
			if (activePencilShape.points.length < 2) {
				shapes = shapes.filter((shape) => shape.id !== activePencilShape?.id);
			}
			activePencilShape = null;
			status = 'Pencil stroke added.';
		}

		if (activeRectangleShape) {
			if (dragOrigin && distanceBetween(dragOrigin, activeRectangleShape.points[2]) < 12) {
				shapes = shapes.filter((shape) => shape.id !== activeRectangleShape?.id);
			}
			activeRectangleShape = null;
			dragOrigin = null;
			status = 'Rectangle added.';
		}

		map?.dragging.enable();
		renderLayers();
	}

	function handleMapClick(event: Leaflet.LeafletMouseEvent) {
		if (phase !== 'editing' || (currentTool !== 'line' && currentTool !== 'polygon')) return;
		pushHistory();

		if (!draft || draft.type !== currentTool) {
			finishDraft();
			draft = {
				id: crypto.randomUUID(),
				points: [toPoint(event.latlng)],
				type: currentTool
			};
		} else {
			draft = {
				...draft,
				points: [...draft.points, toPoint(event.latlng)]
			};
		}

		status = `${toolName(currentTool)} point added.`;
		renderLayers();
	}

	function finishDraft() {
		if (!draft) return;

		const requiredPoints = draft.type === 'polygon' ? 3 : 2;
		if (draft.points.length >= requiredPoints) {
			pushHistory();
			shapes = [...shapes, draft];
			status = `${toolName(draft.type)} finished.`;
		} else {
			status = `${toolName(draft.type)} needs ${requiredPoints} points.`;
		}

		draft = null;
		renderLayers();
	}

	function undo() {
		const previous = undoStack.at(-1);
		if (!previous || phase === 'routing') return;

		undoStack = undoStack.slice(0, -1);
		shapes = cloneShapes(previous.shapes);
		draft = previous.draft ? cloneShape(previous.draft) : null;
		phase = previous.phase;
		route = previous.route.map((point) => ({ ...point }));
		routeDistance = previous.routeDistance;
		activePencilShape = null;
		activeRectangleShape = null;
		dragOrigin = null;
		status = 'Undid recent action.';
		renderLayers();
	}

	async function createRoute() {
		if (!canRoute || phase !== 'editing') return;
		finishDraft();

		const sketchPoints = routeInputPoints();
		if (sketchPoints.length < 2) {
			routeError = 'Add at least two points before routing.';
			return;
		}

		phase = 'routing';
		routeError = '';
		status = 'Routing sketch onto bikeable roads.';

		try {
			const waypoints = prepareWaypoints(sketchPoints);
			const coordinates = waypoints
				.map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`)
				.join(';');
			const url = `${ROUTING_ENDPOINT}/${coordinates}?overview=full&geometries=geojson&steps=false&continue_straight=false`;
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`Routing failed with ${response.status}`);
			}

			const payload = await response.json();
			if (payload.code !== 'Ok' || !payload.routes?.[0]?.geometry?.coordinates?.length) {
				throw new Error(payload.message ?? 'No route found for this drawing.');
			}

			const osrmRoute = payload.routes[0];
			route = osrmRoute.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng }));
			routeDistance = osrmRoute.distance ?? totalDistance(route);
			phase = 'routed';
			status = 'Rideable route generated.';
			renderLayers(true);
		} catch (error) {
			phase = 'editing';
			routeError = error instanceof Error ? error.message : 'Could not create route.';
			status = 'Routing did not complete.';
			renderLayers();
		}
	}

	function backToEditing() {
		phase = 'editing';
		route = [];
		routeDistance = 0;
		routeError = '';
		status = 'Editing sketch.';
		renderLayers();
	}

	function clearDrawing() {
		if (!hasDrawing && route.length === 0) return;
		pushHistory();
		shapes = [];
		draft = null;
		route = [];
		routeDistance = 0;
		routeError = '';
		phase = 'editing';
		status = 'Canvas cleared.';
		renderLayers();
	}

	function downloadGpx() {
		if (route.length < 2) return;
		const gpx = buildGpx(route);
		const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `gpx-art-${new Date().toISOString().slice(0, 10)}.gpx`;
		link.click();
		URL.revokeObjectURL(url);
	}

	function renderLayers(fitRoute = false) {
		if (!L || !drawingLayer || !routeLayer) return;

		drawingLayer.clearLayers();
		routeLayer.clearLayers();

		for (const shape of shapes) {
			addShapeLayer(shape, false);
		}

		if (draft) {
			addShapeLayer(draft, true);
		}

		if (route.length > 1) {
			const routeLine = L.polyline(toLatLngs(route), {
				className: 'route-line',
				color: '#1e7d62',
				interactive: false,
				lineCap: 'round',
				lineJoin: 'round',
				opacity: 0.94,
				weight: 7
			}).addTo(routeLayer);

			L.polyline(toLatLngs(route), {
				color: '#f7f1de',
				interactive: false,
				lineCap: 'round',
				lineJoin: 'round',
				opacity: 0.88,
				weight: 2
			}).addTo(routeLayer);

			if (fitRoute) {
				map?.fitBounds(routeLine.getBounds(), { padding: [42, 42] });
			}
		}
	}

	function addShapeLayer(shape: Shape, isDraft: boolean) {
		if (!L || !drawingLayer || shape.points.length === 0) return;

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

		if (isDraft && shape.points.length > 0) {
			for (const point of shape.points) {
				L.circleMarker([point.lat, point.lng], {
					color: '#f26b3a',
					fillColor: '#fff7df',
					fillOpacity: 1,
					radius: 4,
					weight: 2
				}).addTo(drawingLayer);
			}
		}
	}

	function routeInputPoints() {
		const committed = shapes.flatMap((shape) =>
			shape.type === 'polygon' || shape.type === 'rectangle'
				? closeShape(shape.points)
				: shape.points
		);
		const pending = draft
			? draft.type === 'polygon'
				? closeShape(draft.points)
				: draft.points
			: [];

		return [...committed, ...pending];
	}

	function prepareWaypoints(points: Point[]) {
		const simplified = simplifyPath(points, 0.00008);
		const compacted = removeNearbyPoints(simplified, 20);
		const maxWaypoints = 65;

		if (compacted.length <= maxWaypoints) return compacted;

		const sampled = [];
		for (let index = 0; index < maxWaypoints; index += 1) {
			const sourceIndex = Math.round((index / (maxWaypoints - 1)) * (compacted.length - 1));
			sampled.push(compacted[sourceIndex]);
		}

		return sampled;
	}

	function pushHistory() {
		undoStack = [...undoStack.slice(-39), snapshot()];
	}

	function snapshot(): Snapshot {
		return {
			draft: draft ? cloneShape(draft) : null,
			phase,
			route: route.map((point) => ({ ...point })),
			routeDistance,
			shapes: cloneShapes(shapes)
		};
	}

	function cloneShapes(source: Shape[]) {
		return source.map(cloneShape);
	}

	function cloneShape(shape: Shape): Shape {
		return {
			id: shape.id,
			points: shape.points.map((point) => ({ ...point })),
			type: shape.type
		};
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			finishDraft();
		}

		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			undo();
		}
	}

	function rectanglePoints(start: Point, end: Point): Point[] {
		return [start, { lat: start.lat, lng: end.lng }, end, { lat: end.lat, lng: start.lng }];
	}

	function closeShape(points: Point[]) {
		if (points.length < 2) return points;
		const first = points[0];
		const last = points.at(-1);

		if (last && first.lat === last.lat && first.lng === last.lng) return points;
		return [...points, first];
	}

	function toPoint(latlng: Leaflet.LatLng): Point {
		return { lat: latlng.lat, lng: latlng.lng };
	}

	function toLatLngs(points: Point[]): [number, number][] {
		return points.map((point) => [point.lat, point.lng]);
	}

	function toolName(tool: Tool | ShapeType) {
		const names: Record<Tool, string> = {
			line: 'Line',
			pan: 'Pan',
			pencil: 'Pencil',
			polygon: 'Polygon',
			rectangle: 'Rectangle'
		};

		return names[tool];
	}

	function distanceBetween(a: Point, b: Point) {
		const earthRadius = 6371000;
		const lat1 = toRadians(a.lat);
		const lat2 = toRadians(b.lat);
		const deltaLat = toRadians(b.lat - a.lat);
		const deltaLng = toRadians(b.lng - a.lng);
		const h =
			Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

		return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
	}

	function totalDistance(points: Point[]) {
		return points.reduce((distance, point, index) => {
			if (index === 0) return distance;
			return distance + distanceBetween(points[index - 1], point);
		}, 0);
	}

	function toRadians(degrees: number) {
		return (degrees * Math.PI) / 180;
	}

	function simplifyPath(points: Point[], tolerance: number): Point[] {
		if (points.length <= 2) return points;

		const first = points[0];
		const last = points[points.length - 1];
		let maxDistance = 0;
		let splitIndex = 0;

		for (let index = 1; index < points.length - 1; index += 1) {
			const distance = perpendicularDistance(points[index], first, last);
			if (distance > maxDistance) {
				maxDistance = distance;
				splitIndex = index;
			}
		}

		if (maxDistance <= tolerance) return [first, last];

		return [
			...simplifyPath(points.slice(0, splitIndex + 1), tolerance).slice(0, -1),
			...simplifyPath(points.slice(splitIndex), tolerance)
		];
	}

	function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point) {
		const numerator = Math.abs(
			(lineEnd.lng - lineStart.lng) * (lineStart.lat - point.lat) -
				(lineStart.lng - point.lng) * (lineEnd.lat - lineStart.lat)
		);
		const denominator = Math.hypot(lineEnd.lng - lineStart.lng, lineEnd.lat - lineStart.lat);

		return denominator === 0
			? Math.hypot(point.lng - lineStart.lng, point.lat - lineStart.lat)
			: numerator / denominator;
	}

	function removeNearbyPoints(points: Point[], minimumMeters: number) {
		if (points.length <= 2) return points;

		const compacted = [points[0]];
		for (const point of points.slice(1, -1)) {
			if (distanceBetween(compacted.at(-1)!, point) >= minimumMeters) {
				compacted.push(point);
			}
		}
		compacted.push(points.at(-1)!);

		return compacted;
	}

	function formatDistance(meters: number) {
		if (meters < 1000) return `${Math.round(meters)} m`;
		return `${(meters / 1000).toFixed(1)} km`;
	}

	function buildGpx(points: Point[]) {
		const generatedAt = new Date().toISOString();
		const trackPoints = points
			.map(
				(point) =>
					`      <trkpt lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(7)}"></trkpt>`
			)
			.join('\n');

		return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GPX Art MVP" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>GPX Art Ride</name>
    <time>${generatedAt}</time>
  </metadata>
  <trk>
    <name>GPX Art Ride</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>
`;
	}
</script>

<svelte:head>
	<title>GPX Art</title>
	<meta
		name="description"
		content="Draw a shape on a map, convert it to a rideable GPX route, and export it."
	/>
</svelte:head>

<main class="relative h-svh w-full overflow-hidden" data-phase={phase}>
	<div bind:this={mapElement} class="h-full w-full bg-[#d8d1ba]" aria-label="Drawing map"></div>

	<section
		class="absolute top-[18px] left-[18px] z-[500] flex min-w-[min(430px,calc(100vw-36px))] items-center justify-between gap-[18px] rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/90 px-[14px] py-3 shadow-[0_18px_50px_rgb(27_26_23_/_0.20)] max-[620px]:inset-x-3 max-[620px]:top-3 max-[620px]:min-w-0 max-[620px]:flex-col max-[620px]:items-start max-[620px]:gap-[9px] max-[620px]:p-[11px]"
		aria-label="Workspace status"
	>
		<div class="flex min-w-0 items-center gap-2.5">
			<MapPinned color="#1e7d62" size={21} strokeWidth={2.4} />
			<div>
				<p class="m-0 font-serif text-xl leading-none font-bold">GPX Art</p>
				<span
					class="mt-1 block overflow-hidden text-xs leading-[1.2] text-ellipsis whitespace-nowrap text-[#67604f]"
				>
					{status}
				</span>
			</div>
		</div>
		<div class="flex shrink-0 items-center gap-1.5" aria-label="Route statistics">
			<span
				class="rounded-full bg-[#2c2924] px-[9px] py-[7px] text-xs leading-none font-extrabold text-[#fff7df]"
			>
				{distanceLabel}
			</span>
			<span
				class="rounded-full bg-[#2c2924] px-[9px] py-[7px] text-xs leading-none font-extrabold text-[#fff7df]"
			>
				{pointLabel}
			</span>
		</div>
	</section>

	<section
		class="absolute top-[104px] left-[18px] z-[500] grid items-center gap-[5px] rounded-lg border border-[#fff7df]/25 bg-[#2c2924] p-1.5 shadow-[0_18px_50px_rgb(27_26_23_/_0.28)] max-[620px]:inset-x-3 max-[620px]:top-auto max-[620px]:bottom-[78px] max-[620px]:grid-cols-5"
		aria-label="Drawing tools"
	>
		<button
			aria-label="Pan"
			class={toolButtonClass('pan')}
			disabled={phase !== 'editing'}
			onclick={() => setTool('pan')}
			title="Pan"
			type="button"
		>
			<Hand size={18} />
		</button>
		<button
			aria-label="Pencil"
			class={toolButtonClass('pencil')}
			disabled={phase !== 'editing'}
			onclick={() => setTool('pencil')}
			title="Pencil"
			type="button"
		>
			<Pencil size={18} />
		</button>
		<button
			aria-label="Line"
			class={toolButtonClass('line')}
			disabled={phase !== 'editing'}
			onclick={() => setTool('line')}
			title="Line"
			type="button"
		>
			<Route size={18} />
		</button>
		<button
			aria-label="Polygon"
			class={toolButtonClass('polygon')}
			disabled={phase !== 'editing'}
			onclick={() => setTool('polygon')}
			title="Polygon"
			type="button"
		>
			<Pentagon size={18} />
		</button>
		<button
			aria-label="Rectangle"
			class={toolButtonClass('rectangle')}
			disabled={phase !== 'editing'}
			onclick={() => setTool('rectangle')}
			title="Rectangle"
			type="button"
		>
			<Square size={18} />
		</button>
	</section>

	<section
		class="absolute bottom-[18px] left-[18px] z-[500] flex max-w-[calc(100vw-36px)] flex-wrap items-center gap-[7px] rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 p-2 shadow-[0_18px_50px_rgb(27_26_23_/_0.20)] max-[620px]:inset-x-3 max-[620px]:bottom-3"
		aria-label="Route actions"
	>
		<button
			aria-label="Finish"
			class={neutralActionButton}
			disabled={phase !== 'editing' || !draft}
			onclick={finishDraft}
			title="Finish shape"
			type="button"
		>
			<Check size={18} />
			<span>Finish</span>
		</button>
		<button
			aria-label="Undo"
			class={neutralActionButton}
			disabled={phase === 'routing' || undoStack.length === 0}
			onclick={undo}
			title="Undo"
			type="button"
		>
			<Undo2 size={18} />
			<span>Undo</span>
		</button>
		<button
			aria-label="Clear"
			class={neutralActionButton}
			disabled={phase !== 'editing' || !hasDrawing}
			onclick={clearDrawing}
			title="Clear"
			type="button"
		>
			<Trash2 size={18} />
			<span>Clear</span>
		</button>
		{#if phase === 'routed'}
			<button
				aria-label="Export GPX"
				class={primaryActionButton}
				onclick={downloadGpx}
				title="Export GPX"
				type="button"
			>
				<Download size={18} />
				<span>GPX</span>
			</button>
			<button
				aria-label="Edit sketch"
				class={neutralActionButton}
				onclick={backToEditing}
				title="Edit sketch"
				type="button"
			>
				<RotateCcw size={18} />
				<span>Edit</span>
			</button>
		{:else}
			<button
				aria-label="Route"
				class={primaryActionButton}
				disabled={!canRoute || phase === 'routing'}
				onclick={createRoute}
				title="Route"
				type="button"
			>
				{#if phase === 'routing'}
					<span class="animate-spin"><LoaderCircle size={18} /></span>
				{:else}
					<Eraser size={18} />
				{/if}
				<span>{phase === 'routing' ? 'Routing' : 'Route'}</span>
			</button>
		{/if}
	</section>

	{#if routeError}
		<p
			class="absolute bottom-[84px] left-[18px] z-[500] m-0 max-w-[min(420px,calc(100vw-36px))] rounded-lg border border-[#f26b3a] bg-[#fff7df] px-3 py-2.5 text-[13px] font-extrabold text-[#88380f] shadow-[0_14px_36px_rgb(27_26_23_/_0.18)] max-[620px]:inset-x-3 max-[620px]:bottom-[136px]"
			role="status"
		>
			{routeError}
		</p>
	{/if}
</main>
