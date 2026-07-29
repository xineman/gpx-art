import type { LineString } from 'geojson';
import { decodePolyline6, encodePolyline6 } from './polyline';
import { buildValhallaTraceUrl } from './urls';
import type { ValhallaConfig } from './types.server';
import type {
	AttributedRouteEdge,
	RouteAttributionResponse,
	RouteRoadAttributes,
	RouteRoadKind,
	RouteRoadSpan
} from '../../attribution/types';

const TRACE_ATTRIBUTES = [
	'edge.id',
	'edge.way_id',
	'edge.length',
	'edge.begin_shape_index',
	'edge.end_shape_index',
	'edge.names',
	'edge.road_class',
	'edge.use',
	'edge.surface',
	'edge.cycle_lane',
	'edge.bicycle_network',
	'edge.weighted_grade',
	'edge.max_upward_grade',
	'edge.max_downward_grade',
	'edge.mean_elevation',
	'shape'
];

type ValhallaTraceEdge = {
	id?: string | number;
	way_id?: number;
	length?: number;
	begin_shape_index?: number;
	end_shape_index?: number;
	names?: unknown[];
	road_class?: string;
	use?: string;
	surface?: string;
	cycle_lane?: string;
	bicycle_network?: string | number;
	weighted_grade?: number;
	max_upward_grade?: number;
	max_downward_grade?: number;
	mean_elevation?: number;
};

type ValhallaTracePayload = {
	edges?: ValhallaTraceEdge[];
	shape?: string;
	error?: string;
	error_code?: number;
};

type ParsedReference = {
	canonical: string;
	kind: RouteRoadKind | null;
	international: boolean;
};

export type ParsedRoadNames = {
	refs: string[];
	ref: string | null;
	name: string | null;
	roadKind: RouteRoadKind;
	displayLabel: string;
};

const numberOrNull = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;

const stringOrNull = (value: unknown): string | null =>
	typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

function classifyReference(value: string): ParsedReference | null {
	const compact = value.toUpperCase().replaceAll(/\s+/g, '');
	let match = compact.match(/^A(\d{1,2})$/);
	if (match) return { canonical: `A${Number(match[1])}`, kind: 'national', international: false };

	match = compact.match(/^S(\d{1,2})$/);
	if (match) return { canonical: `S${Number(match[1])}`, kind: 'national', international: false };

	match = compact.match(/^DK(\d{1,2})$/);
	if (match) return { canonical: `DK${Number(match[1])}`, kind: 'national', international: false };

	match = compact.match(/^DW(\d{3})$/);
	if (match) {
		return { canonical: `DW${Number(match[1])}`, kind: 'voivodeship', international: false };
	}

	match = compact.match(/^DP([A-Z0-9-]+)$/);
	if (match) return { canonical: `DP${match[1]}`, kind: 'county', international: false };

	match = compact.match(/^DG([A-Z0-9-]+)$/);
	if (match) return { canonical: `DG${match[1]}`, kind: 'municipal', international: false };

	match = compact.match(/^E(\d{1,3})$/);
	if (match) return { canonical: `E${Number(match[1])}`, kind: null, international: true };

	match = compact.match(/^(\d{1,2})$/);
	if (match) return { canonical: `DK${Number(match[1])}`, kind: 'national', international: false };

	match = compact.match(/^(\d{3})$/);
	if (match) {
		return { canonical: `DW${Number(match[1])}`, kind: 'voivodeship', international: false };
	}

	return null;
}

export function parsePolishRoadNames(names: unknown[]): ParsedRoadNames {
	const references: ParsedReference[] = [];
	const streetNames: string[] = [];

	for (const entry of names) {
		const value = stringOrNull(entry);
		if (!value) continue;
		const reference = classifyReference(value);
		if (reference) references.push(reference);
		else streetNames.push(value);
	}

	const domestic = references.find((reference) => !reference.international && reference.kind);
	const international = references.find((reference) => reference.international);
	const ordered = [...references].sort((a, b) => Number(a.international) - Number(b.international));
	const refs = [...new Set(ordered.map((reference) => reference.canonical))];
	const ref = domestic?.canonical ?? international?.canonical ?? null;
	const name = streetNames[0] ?? null;

	return {
		refs,
		ref,
		name,
		roadKind: domestic?.kind ?? 'other',
		displayLabel: refs.join(' · ') || name || 'Unnamed road'
	};
}

function edgeAttributes(edge: ValhallaTraceEdge): RouteRoadAttributes {
	return {
		roadClass: stringOrNull(edge.road_class),
		use: stringOrNull(edge.use),
		surface: stringOrNull(edge.surface),
		cycleLane: stringOrNull(edge.cycle_lane),
		bicycleNetwork:
			typeof edge.bicycle_network === 'string' || typeof edge.bicycle_network === 'number'
				? edge.bicycle_network
				: null,
		weightedGrade: numberOrNull(edge.weighted_grade),
		maxUpwardGrade: numberOrNull(edge.max_upward_grade),
		maxDownwardGrade: numberOrNull(edge.max_downward_grade),
		meanElevationM: numberOrNull(edge.mean_elevation)
	};
}

function parseTrace(payload: ValhallaTracePayload, fallbackShape: string) {
	const coordinates = decodePolyline6(payload.shape ?? fallbackShape);
	if (!coordinates || coordinates.length < 2) {
		throw new Error('Valhalla returned an empty route shape');
	}

	let cumulativeM = 0;
	const edges = (payload.edges ?? []).map((edge, index): AttributedRouteEdge => {
		const startShapeIndex = edge.begin_shape_index;
		const endShapeIndex = edge.end_shape_index;
		if (
			!Number.isInteger(startShapeIndex) ||
			!Number.isInteger(endShapeIndex) ||
			(startShapeIndex ?? -1) < 0 ||
			(endShapeIndex ?? -1) < (startShapeIndex ?? -1) ||
			(endShapeIndex ?? coordinates.length) >= coordinates.length
		) {
			throw new Error('Valhalla returned invalid road shape indexes');
		}

		const startIndex = startShapeIndex as number;
		const endIndex = endShapeIndex as number;
		const roadNames = parsePolishRoadNames(edge.names ?? []);
		const attributes = edgeAttributes(edge);
		const distanceM = Math.max(0, (numberOrNull(edge.length) ?? 0) * 1000);
		const startM = cumulativeM;
		const endM = startM + distanceM;
		cumulativeM = endM;

		return {
			id: String(edge.id ?? index),
			wayId: numberOrNull(edge.way_id),
			...roadNames,
			displayLabel:
				roadNames.displayLabel === 'Unnamed road' && attributes.use === 'cycleway'
					? 'Cycleway'
					: roadNames.displayLabel,
			...attributes,
			start: [...coordinates[startIndex]],
			end: [...coordinates[endIndex]],
			startM,
			endM,
			distanceM,
			startShapeIndex: startIndex,
			endShapeIndex: endIndex
		};
	});

	if (edges.length === 0) throw new Error('Valhalla returned no road edges');
	return { coordinates, edges };
}

function canMerge(left: AttributedRouteEdge | RouteRoadSpan, right: AttributedRouteEdge): boolean {
	if (left.use !== right.use || left.cycleLane !== right.cycleLane) {
		return false;
	}
	if (left.ref || right.ref) return Boolean(left.ref && right.ref && left.ref === right.ref);
	if (left.name || right.name) {
		return Boolean(
			left.name &&
			right.name &&
			left.roadKind === right.roadKind &&
			left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) === 0
		);
	}
	return (
		left.roadKind === right.roadKind && left.roadClass === right.roadClass && left.use === right.use
	);
}

function commonValue<T>(left: T | null, right: T | null): T | null {
	return left === right ? left : null;
}

export function buildRoadSpans(edges: AttributedRouteEdge[]): RouteRoadSpan[] {
	const spans: RouteRoadSpan[] = [];

	for (const edge of edges) {
		const previous = spans.at(-1);
		if (!previous || !canMerge(previous, edge)) {
			spans.push({
				...edge,
				start: [...edge.start],
				end: [...edge.end],
				refs: [...edge.refs],
				wayIds: edge.wayId === null ? [] : [edge.wayId]
			});
			continue;
		}

		previous.end = [...edge.end];
		previous.endM = edge.endM;
		previous.distanceM = previous.endM - previous.startM;
		previous.endShapeIndex = edge.endShapeIndex;
		previous.refs = [...new Set([...previous.refs, ...edge.refs])];
		if (edge.wayId !== null && !previous.wayIds.includes(edge.wayId)) {
			previous.wayIds.push(edge.wayId);
		}
		if (!previous.ref && !previous.name && previous.wayIds.length > 1) {
			previous.displayLabel = previous.use === 'cycleway' ? 'Cycleway' : 'Local streets';
		}
		previous.roadClass = commonValue(previous.roadClass, edge.roadClass);
		previous.use = commonValue(previous.use, edge.use);
		previous.surface = commonValue(previous.surface, edge.surface);
		previous.cycleLane = commonValue(previous.cycleLane, edge.cycleLane);
		previous.bicycleNetwork = commonValue(previous.bicycleNetwork, edge.bicycleNetwork);
		previous.weightedGrade = commonValue(previous.weightedGrade, edge.weightedGrade);
		previous.maxUpwardGrade = commonValue(previous.maxUpwardGrade, edge.maxUpwardGrade);
		previous.maxDownwardGrade = commonValue(previous.maxDownwardGrade, edge.maxDownwardGrade);
		previous.meanElevationM = commonValue(previous.meanElevationM, edge.meanElevationM);
	}

	return spans;
}

async function postTrace(
	encodedPolyline: string,
	shapeMatch: 'edge_walk' | 'walk_or_snap',
	config: ValhallaConfig
): Promise<
	| { ok: true; payload: ValhallaTracePayload }
	| { ok: false; error: string; errorCode: number | null }
> {
	const fetchFn = config.fetchFn ?? fetch;
	let response: Response;
	try {
		response = await fetchFn(buildValhallaTraceUrl(config.baseUrl), {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': config.userAgent
			},
			body: JSON.stringify({
				encoded_polyline: encodedPolyline,
				shape_match: shapeMatch,
				costing: 'bicycle',
				costing_options: { bicycle: { bicycle_type: 'hybrid' } },
				units: 'kilometers',
				filters: { action: 'include', attributes: TRACE_ATTRIBUTES }
			})
		});
	} catch {
		return { ok: false, error: 'Routing server unavailable', errorCode: null };
	}

	let payload: ValhallaTracePayload | null = null;
	try {
		payload = (await response.json()) as ValhallaTracePayload;
	} catch {
		// Handled as an unavailable/invalid upstream response below.
	}
	if (!response.ok || !payload) {
		return {
			ok: false,
			error: payload?.error ?? 'Routing server unavailable',
			errorCode: numberOrNull(payload?.error_code)
		};
	}
	return { ok: true, payload };
}

function isExactMatchFailure(result: { error: string; errorCode: number | null }) {
	return result.errorCode === 443 || result.error.includes('Exact route match algorithm failed');
}

/** Derive named/numbered road spans from an already accepted route geometry. */
export async function fetchValhallaAttributes(
	geometry: LineString,
	config: ValhallaConfig
): Promise<RouteAttributionResponse> {
	const encodedPolyline = encodePolyline6(geometry.coordinates);
	let result = await postTrace(encodedPolyline, 'edge_walk', config);
	if (!result.ok && isExactMatchFailure(result)) {
		result = await postTrace(encodedPolyline, 'walk_or_snap', config);
	}
	if (!result.ok) return { ok: false, error: result.error };

	try {
		const parsed = parseTrace(result.payload, encodedPolyline);
		return {
			ok: true,
			geometry: { type: 'LineString', coordinates: parsed.coordinates },
			distanceM: parsed.edges.at(-1)?.endM ?? 0,
			roadEdges: parsed.edges,
			roadSpans: buildRoadSpans(parsed.edges)
		};
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'Invalid route details' };
	}
}
