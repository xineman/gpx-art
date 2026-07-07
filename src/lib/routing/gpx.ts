import type { Point } from '$lib/types/sketch';

// Emit a GPX 1.1 document containing a single track with a single segment.
//
// One `<trkseg>` per contiguous path — we emit just one because the routed
// output is logically one ride, even if it has shape-to-shape transitions. GPX
// supports multiple segments but most consumers (Strava, Komoot, gpx.studio)
// treat them as separate laps, which would split the route visually.
//
// Coordinates are emitted with 7 decimal places (~11mm precision), which is
// the resolution GPX producers like Strava emit and what most consumers expect.
export function pointsToGpx(points: Point[], name: string = 'gpx-art route'): string {
	const esc = escapeXml(name);
	const now = new Date().toISOString();

	const trkpts = points.map(
		(p) => `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}"/>`
	);

	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<gpx version="1.1" creator="gpx-art" xmlns="http://www.topografix.com/GPX/1/1">`,
		`  <metadata>`,
		`    <time>${now}</time>`,
		`  </metadata>`,
		`  <trk>`,
		`    <name>${esc}</name>`,
		`    <trkseg>`,
		...trkpts,
		`    </trkseg>`,
		`  </trk>`,
		`</gpx>`,
		''
	].join('\n');
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
