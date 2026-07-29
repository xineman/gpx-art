import type { Position } from 'geojson';

function decodeValue(encoded: string, start: number): { value: number; next: number } | null {
	let result = 0;
	let shift = 0;
	let index = start;

	while (index < encoded.length && shift <= 30) {
		const value = encoded.charCodeAt(index++) - 63;
		if (value < 0 || value > 63) return null;
		result |= (value & 0x1f) << shift;
		if (value < 0x20) {
			return { value: result & 1 ? ~(result >> 1) : result >> 1, next: index };
		}
		shift += 5;
	}

	return null;
}

/** Decode Valhalla's six-decimal encoded route shape into GeoJSON `[lng, lat]` positions. */
export function decodePolyline6(encoded: string): Position[] | null {
	const coordinates: Position[] = [];
	let index = 0;
	let latitude = 0;
	let longitude = 0;

	while (index < encoded.length) {
		const latitudeDelta = decodeValue(encoded, index);
		if (!latitudeDelta) return null;
		const longitudeDelta = decodeValue(encoded, latitudeDelta.next);
		if (!longitudeDelta) return null;

		latitude += latitudeDelta.value;
		longitude += longitudeDelta.value;
		coordinates.push([longitude / 1_000_000, latitude / 1_000_000]);
		index = longitudeDelta.next;
	}

	return coordinates;
}

function encodeSignedValue(value: number): string {
	let encoded = '';
	let shifted = value < 0 ? ~(value << 1) : value << 1;
	while (shifted >= 0x20) {
		encoded += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
		shifted >>= 5;
	}
	return encoded + String.fromCharCode(shifted + 63);
}

/** Encode GeoJSON `[lng, lat]` positions using Valhalla's six-decimal polyline format. */
export function encodePolyline6(coordinates: Position[]): string {
	let latitude = 0;
	let longitude = 0;
	return coordinates
		.map(([longitudeValue, latitudeValue]) => {
			const nextLatitude = Math.round(latitudeValue * 1_000_000);
			const nextLongitude = Math.round(longitudeValue * 1_000_000);
			const value =
				encodeSignedValue(nextLatitude - latitude) + encodeSignedValue(nextLongitude - longitude);
			latitude = nextLatitude;
			longitude = nextLongitude;
			return value;
		})
		.join('');
}
