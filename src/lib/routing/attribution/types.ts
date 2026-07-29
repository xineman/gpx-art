import type { LineString, Position } from 'geojson';
import type { RouteFailure } from '../shared/failure';

export type RouteRoadKind = 'national' | 'voivodeship' | 'county' | 'municipal' | 'other';

export type RouteRoadAttributes = {
	roadClass: string | null;
	use: string | null;
	surface: string | null;
	cycleLane: string | null;
	bicycleNetwork: string | number | null;
	weightedGrade: number | null;
	maxUpwardGrade: number | null;
	maxDownwardGrade: number | null;
	meanElevationM: number | null;
};

export type AttributedRouteEdge = RouteRoadAttributes & {
	id: string;
	wayId: number | null;
	refs: string[];
	ref: string | null;
	displayLabel: string;
	name: string | null;
	roadKind: RouteRoadKind;
	start: Position;
	end: Position;
	startM: number;
	endM: number;
	distanceM: number;
	startShapeIndex: number;
	endShapeIndex: number;
};

export type RouteRoadSpan = RouteRoadAttributes & {
	wayId: number | null;
	wayIds: number[];
	refs: string[];
	ref: string | null;
	displayLabel: string;
	name: string | null;
	roadKind: RouteRoadKind;
	start: Position;
	end: Position;
	startM: number;
	endM: number;
	distanceM: number;
	startShapeIndex: number;
	endShapeIndex: number;
};

export type RouteAttributionSuccess = {
	ok: true;
	geometry: LineString;
	distanceM: number;
	roadEdges: AttributedRouteEdge[];
	roadSpans: RouteRoadSpan[];
};

export type RouteAttributionResponse = RouteAttributionSuccess | RouteFailure;
