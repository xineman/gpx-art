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
// Precision-5 encoder (inverse of decodePolyline). Used in unit tests and
// any future share-link feature.
export function encodePolyline(points: Point[], precision = 5): string {
	const factor = Math.pow(10, precision);
	let prevLat = 0;
	let prevLng = 0;
	let result = '';

	const encodeSigned = (value: number): string => {
		let v = value < 0 ? ~(value << 1) : value << 1;
		let out = '';
		while (v >= 0x20) {
			out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
			v >>= 5;
		}
		out += String.fromCharCode(v + 63);
		return out;
	};

	for (const p of points) {
		const lat = Math.round(p.lat * factor);
		const lng = Math.round(p.lng * factor);
		result += encodeSigned(lat - prevLat);
		result += encodeSigned(lng - prevLng);
		prevLat = lat;
		prevLng = lng;
	}
	return result;
}

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
