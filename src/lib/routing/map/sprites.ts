import type { Map as MaplibreMap } from 'maplibre-gl';
import { themeColor } from '#lib/map/theme.js';

/** Sprite id registered via `map.addImage` for line-following direction marks. */
export const ROUTE_CHEVRON_IMAGE = 'gpx-route-chevron';
export const ROUTE_MOVE_WAYPOINT_IMAGE = 'gpx-route-waypoint-move';
export const ROUTE_REMOVE_WAYPOINT_IMAGE = 'gpx-route-waypoint-remove';
export const ROUTE_MOVE_TARGET_IMAGE = 'gpx-route-move-target-reticle';

/**
 * Canvas-drawn chevron pointing right (travel direction along LineString order).
 * With `symbol-placement: line`, MapLibre rotates it to match the path.
 */
function ensureRouteChevronImage(map: MaplibreMap) {
	if (map.hasImage(ROUTE_CHEVRON_IMAGE)) return;

	// High-res sprite; pixelRatio 2 → ~16 CSS px on map.
	const size = 32;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	const fill = themeColor('ink-dark');
	const edge = themeColor('trail-vertex');

	// Soft halo so chevrons stay readable on both blaze stroke and map basemap.
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.strokeStyle = edge;
	ctx.lineWidth = 5;
	ctx.beginPath();
	ctx.moveTo(8, 6);
	ctx.lineTo(22, 16);
	ctx.lineTo(8, 26);
	ctx.stroke();

	// Solid arrowhead (filled chevron) — clearer than a hairline at map scale.
	ctx.fillStyle = fill;
	ctx.beginPath();
	ctx.moveTo(7, 6);
	ctx.lineTo(23, 16);
	ctx.lineTo(7, 26);
	ctx.closePath();
	ctx.fill();

	// Inner notch so it reads as › not a solid triangle.
	ctx.globalCompositeOperation = 'destination-out';
	ctx.beginPath();
	ctx.moveTo(7, 10);
	ctx.lineTo(15, 16);
	ctx.lineTo(7, 22);
	ctx.closePath();
	ctx.fill();
	ctx.globalCompositeOperation = 'source-over';

	const imageData = ctx.getImageData(0, 0, size, size);
	map.addImage(
		ROUTE_CHEVRON_IMAGE,
		{
			width: size,
			height: size,
			data: new Uint8Array(imageData.data)
		},
		{ pixelRatio: 2 }
	);
}

/** Compact action glyphs layered over route-waypoint circles. */
function ensureRouteWaypointActionImages(map: MaplibreMap) {
	const ink = themeColor('ink-dark');

	function addActionImage(id: string, action: 'move' | 'remove') {
		if (map.hasImage(id)) return;

		const size = 32;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		ctx.strokeStyle = ink;
		ctx.lineWidth = 4;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		if (action === 'move') {
			// A short diagonal arrow reads as a map nudge without implying route direction.
			ctx.moveTo(9, 23);
			ctx.lineTo(22, 10);
			ctx.moveTo(15, 10);
			ctx.lineTo(22, 10);
			ctx.lineTo(22, 17);
		} else {
			ctx.moveTo(9, 16);
			ctx.lineTo(23, 16);
		}
		ctx.stroke();

		const imageData = ctx.getImageData(0, 0, size, size);
		map.addImage(
			id,
			{
				width: size,
				height: size,
				data: new Uint8Array(imageData.data)
			},
			{ pixelRatio: 2 }
		);
	}

	addActionImage(ROUTE_MOVE_WAYPOINT_IMAGE, 'move');
	addActionImage(ROUTE_REMOVE_WAYPOINT_IMAGE, 'remove');
}

/** Survey reticle marking the exact destination of a proposed waypoint move. */
function ensureRouteMoveTargetImage(map: MaplibreMap) {
	if (map.hasImage(ROUTE_MOVE_TARGET_IMAGE)) return;

	const size = 32;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	const drawTicks = () => {
		ctx.beginPath();
		ctx.moveTo(7, 16);
		ctx.lineTo(12, 16);
		ctx.moveTo(20, 16);
		ctx.lineTo(25, 16);
		ctx.moveTo(16, 7);
		ctx.lineTo(16, 12);
		ctx.moveTo(16, 20);
		ctx.lineTo(16, 25);
		ctx.stroke();
	};

	// A light under-stroke keeps the fine reticle legible over streets and labels.
	ctx.strokeStyle = themeColor('trail-vertex');
	ctx.lineWidth = 5;
	drawTicks();
	ctx.fillStyle = themeColor('trail-vertex');
	ctx.beginPath();
	ctx.arc(16, 16, 4, 0, Math.PI * 2);
	ctx.fill();

	ctx.strokeStyle = themeColor('ember');
	ctx.lineWidth = 2.5;
	drawTicks();
	ctx.fillStyle = themeColor('ember');
	ctx.beginPath();
	ctx.arc(16, 16, 2, 0, Math.PI * 2);
	ctx.fill();

	const imageData = ctx.getImageData(0, 0, size, size);
	map.addImage(
		ROUTE_MOVE_TARGET_IMAGE,
		{
			width: size,
			height: size,
			data: new Uint8Array(imageData.data)
		},
		{ pixelRatio: 2 }
	);
}

/** Register every route sprite once per map style. */
export function ensureRouteSprites(map: MaplibreMap) {
	ensureRouteChevronImage(map);
	ensureRouteWaypointActionImages(map);
	ensureRouteMoveTargetImage(map);
}
