import {
	DETOUR_RATIO,
	MATCH_FALLBACK_MAX_VIAS,
	MATCH_FALLBACK_RDP_TOLERANCE,
	MATCH_RADIUS_METERS,
	MATCH_RADIUS_WAYPOINT_METERS,
	MATCH_SAMPLE_SPACING_METERS,
	RDP_TOLERANCE_PENCIL,
	STRUCTURED_CORNER_INSET_METERS,
	STRUCTURED_EDGE_DEVIATION_METERS,
	STRUCTURED_EDGE_VIA_MIN_METERS,
	STRUCTURED_MAX_VIAS_PER_EDGE,
	STRUCTURED_VIA_SPACING_METERS
} from '$lib/constants/routing';

/** How tightly the route should hug the sketch. Balanced = current code defaults. */
export const ROUTE_FIDELITIES = ['loose', 'balanced', 'strict'] as const;
export type RouteFidelity = (typeof ROUTE_FIDELITIES)[number];

/**
 * Tunable routing knobs used by prepareShapeRoute / getMatchedRoute /
 * structured edge routing. Infrastructure limits (chunk size, clean bridge
 * budget, TSP caps) stay hardcoded in constants/routing.ts.
 */
export type RoutingOptions = {
	rdpTolerancePencil: number;
	matchFallbackRdpTolerance: number;
	matchFallbackMaxVias: number;
	detourRatio: number;
	matchRadiusMeters: number;
	matchRadiusWaypointMeters: number;
	matchSampleSpacingMeters: number;
	structuredEdgeDeviationMeters: number;
	structuredViaSpacingMeters: number;
	structuredEdgeViaMinMeters: number;
	structuredMaxViasPerEdge: number;
	structuredCornerInsetMeters: number;
};

export const CORNER_INSET_MIN_METERS = 0;
export const CORNER_INSET_MAX_METERS = 250;
export const CORNER_INSET_DEFAULT_METERS = STRUCTURED_CORNER_INSET_METERS;

/** Current production defaults — source of truth for the Balanced preset. */
export function defaultRoutingOptions(
	cornerInsetMeters = CORNER_INSET_DEFAULT_METERS
): RoutingOptions {
	return {
		rdpTolerancePencil: RDP_TOLERANCE_PENCIL,
		matchFallbackRdpTolerance: MATCH_FALLBACK_RDP_TOLERANCE,
		matchFallbackMaxVias: MATCH_FALLBACK_MAX_VIAS,
		detourRatio: DETOUR_RATIO,
		matchRadiusMeters: MATCH_RADIUS_METERS,
		matchRadiusWaypointMeters: MATCH_RADIUS_WAYPOINT_METERS,
		matchSampleSpacingMeters: MATCH_SAMPLE_SPACING_METERS,
		structuredEdgeDeviationMeters: STRUCTURED_EDGE_DEVIATION_METERS,
		structuredViaSpacingMeters: STRUCTURED_VIA_SPACING_METERS,
		structuredEdgeViaMinMeters: STRUCTURED_EDGE_VIA_MIN_METERS,
		structuredMaxViasPerEdge: STRUCTURED_MAX_VIAS_PER_EDGE,
		structuredCornerInsetMeters: clampCornerInset(cornerInsetMeters)
	};
}

/** Fidelity-only fields (corner inset is independent). */
type FidelityFields = Omit<RoutingOptions, 'structuredCornerInsetMeters'>;

const FIDELITY_PRESETS: Record<RouteFidelity, FidelityFields> = {
	// Coarser pencil, more detour forgiveness, looser structured densify.
	loose: {
		rdpTolerancePencil: 20,
		matchFallbackRdpTolerance: 40,
		matchFallbackMaxVias: 8,
		detourRatio: 1.6,
		matchRadiusMeters: 50,
		matchRadiusWaypointMeters: 150,
		matchSampleSpacingMeters: 90,
		structuredEdgeDeviationMeters: 400,
		structuredViaSpacingMeters: 450,
		structuredEdgeViaMinMeters: 250,
		structuredMaxViasPerEdge: 10
	},
	// Exact current constants from routing.ts.
	balanced: {
		rdpTolerancePencil: RDP_TOLERANCE_PENCIL,
		matchFallbackRdpTolerance: MATCH_FALLBACK_RDP_TOLERANCE,
		matchFallbackMaxVias: MATCH_FALLBACK_MAX_VIAS,
		detourRatio: DETOUR_RATIO,
		matchRadiusMeters: MATCH_RADIUS_METERS,
		matchRadiusWaypointMeters: MATCH_RADIUS_WAYPOINT_METERS,
		matchSampleSpacingMeters: MATCH_SAMPLE_SPACING_METERS,
		structuredEdgeDeviationMeters: STRUCTURED_EDGE_DEVIATION_METERS,
		structuredViaSpacingMeters: STRUCTURED_VIA_SPACING_METERS,
		structuredEdgeViaMinMeters: STRUCTURED_EDGE_VIA_MIN_METERS,
		structuredMaxViasPerEdge: STRUCTURED_MAX_VIAS_PER_EDGE
	},
	// Tighter freehand, stricter detour gate, denser structured vias.
	strict: {
		rdpTolerancePencil: 5,
		matchFallbackRdpTolerance: 12,
		matchFallbackMaxVias: 18,
		detourRatio: 1.2,
		matchRadiusMeters: 20,
		matchRadiusWaypointMeters: 70,
		matchSampleSpacingMeters: 40,
		structuredEdgeDeviationMeters: 120,
		structuredViaSpacingMeters: 180,
		structuredEdgeViaMinMeters: 80,
		structuredMaxViasPerEdge: 24
	}
};

export function resolveRoutingOptions(
	fidelity: RouteFidelity,
	cornerInsetMeters = CORNER_INSET_DEFAULT_METERS
): RoutingOptions {
	return {
		...FIDELITY_PRESETS[fidelity],
		structuredCornerInsetMeters: clampCornerInset(cornerInsetMeters)
	};
}

export function clampCornerInset(meters: number): number {
	if (!Number.isFinite(meters)) return CORNER_INSET_DEFAULT_METERS;
	return Math.max(CORNER_INSET_MIN_METERS, Math.min(CORNER_INSET_MAX_METERS, Math.round(meters)));
}

export function isRouteFidelity(value: unknown): value is RouteFidelity {
	return value === 'loose' || value === 'balanced' || value === 'strict';
}

export function fidelityLabel(fidelity: RouteFidelity): string {
	switch (fidelity) {
		case 'loose':
			return 'Loose';
		case 'balanced':
			return 'Balanced';
		case 'strict':
			return 'Strict';
	}
}
