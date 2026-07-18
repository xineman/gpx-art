export function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function isFinitePosition(value: unknown): value is [number, number] {
	return (
		Array.isArray(value) &&
		value.length >= 2 &&
		typeof value[0] === 'number' &&
		typeof value[1] === 'number' &&
		Number.isFinite(value[0]) &&
		Number.isFinite(value[1])
	);
}

export function inCoordinateRange([lng, lat]: [number, number]): boolean {
	return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}
