import { describe, expect, it } from 'vitest';
import { lineStringToGpx, routeGpxFilename } from './gpx';

describe('lineStringToGpx', () => {
	it('emits track points with lat/lon swapped from GeoJSON', () => {
		const gpx = lineStringToGpx({
			type: 'LineString',
			coordinates: [
				[21.01, 52.22],
				[21.02, 52.23]
			]
		});
		expect(gpx).toContain('<?xml version="1.0"');
		expect(gpx).toContain('<trkpt lat="52.22" lon="21.01"');
		expect(gpx).toContain('<trkpt lat="52.23" lon="21.02"');
		expect(gpx).toContain('GPX Art route');
	});

	it('escapes name metadata', () => {
		const gpx = lineStringToGpx(
			{
				type: 'LineString',
				coordinates: [
					[0, 0],
					[1, 1]
				]
			},
			{ name: 'A & B <test>' }
		);
		expect(gpx).toContain('A &amp; B &lt;test&gt;');
	});
});

describe('routeGpxFilename', () => {
	it('uses local timestamp stamp', () => {
		const d = new Date(2026, 6, 16, 9, 4, 7);
		expect(routeGpxFilename(d)).toBe('gpx-art-route-2026-07-16-09-04-07.gpx');
	});
});
