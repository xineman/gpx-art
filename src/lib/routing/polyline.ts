import type { Point } from '$lib/types/sketch';

// Google "Encoded Polyline Algorithm" decoder.
//
// Each coordinate is encoded as a sequence of varints: 5-bit chunks with the
// 6th bit (0x20) acting as a continuation marker. The accumulated integer is
// the encoded delta from the previous coordinate; bit 0 of that integer is a
// sign flag, the rest is the magnitude.
//
// OSRM uses precision=5 (1e-5 degree units) by default, which is what GPX
// consumers expect — that's the resolution Strava, Komoot, etc. emit too.
//
// TODO: if we ever need to *encode* polylines (e.g. for a future "share link"
// feature), drop in the matching encoder here.
export function decodePolyline(encoded: string, precision = 5): Point[] {
	const factor = Math.pow(10, precision);
	const points: Point[] = [];
	let lat = 0;
	let lng = 0;
	let i = 0;

	const decodeVarint = (): number => {
		let byte: number;
		let shift = 0;
		let result = 0;
		do {
			byte = encoded.charCodeAt(i++) - 63;
			result |= (byte & 0x1f) << shift;
			shift += 5;
		} while (byte >= 0x20);
		return result;
	};

	while (i < encoded.length) {
		const dlat = decodeVarint();
		lat += dlat & 1 ? ~(dlat >> 1) : dlat >> 1;

		const dlng = decodeVarint();
		lng += dlng & 1 ? ~(dlng >> 1) : dlng >> 1;

		points.push({ lat: lat / factor, lng: lng / factor });
	}

	return points;
}
