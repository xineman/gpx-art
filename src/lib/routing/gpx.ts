import type { LineString, Position } from 'geojson';

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function trackPointXml(p: Position): string {
	const lon = p[0]!;
	const lat = p[1]!;
	return `<trkpt lat="${lat}" lon="${lon}"></trkpt>`;
}

/**
 * Serialize a route LineString as GPX 1.1 with a single track.
 * Coordinates are GeoJSON `[lng, lat]` → GPX `lat` / `lon`.
 */
export function lineStringToGpx(
	geometry: LineString,
	options: { name?: string; creator?: string } = {}
): string {
	const name = escapeXml(options.name ?? 'GPX Art route');
	const creator = escapeXml(options.creator ?? 'GPX Art');
	const points = geometry.coordinates;
	const trkpts = points.map(trackPointXml).join('\n      ');

	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
      ${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Local-time export filename: `gpx-art-route-YYYY-MM-DD-HH-mm-ss.gpx`. */
export function routeGpxFilename(date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	const stamp = [
		date.getFullYear(),
		p(date.getMonth() + 1),
		p(date.getDate()),
		p(date.getHours()),
		p(date.getMinutes()),
		p(date.getSeconds())
	].join('-');
	return `gpx-art-route-${stamp}.gpx`;
}
