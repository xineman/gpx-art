import {
	PENCIL_MAX_VIAS,
	PENCIL_ROUTE_RDP_TOLERANCE,
	PENCIL_SAMPLE_SPACING_METERS,
	RDP_TOLERANCE_PENCIL,
	STRUCTURED_CORNER_INSET_METERS,
	STRUCTURED_DENSE_LENGTH_RATIO,
	STRUCTURED_EDGE_DEVIATION_METERS,
	STRUCTURED_EDGE_VIA_MIN_METERS,
	STRUCTURED_MAX_VIAS_PER_EDGE,
	STRUCTURED_VIA_SPACING_METERS
} from '$lib/constants/routing';

/** How tightly the route should hug the sketch. Balanced = current code defaults. */
export const ROUTE_FIDELITIES = ['loose', 'balanced', 'strict'] as const;
export type RouteFidelity = (typeof ROUTE_FIDELITIES)[number];

/**
 * Tunable routing knobs used by prepareShapeRoute / structured edge routing.
 * Infrastructure limits (clean bridge budget, TSP caps) stay in routing.ts.
 */
export type RoutingOptions = {
	rdpTolerancePencil: number;
	pencilRouteRdpTolerance: number;
	pencilMaxVias: number;
	pencilSampleSpacingMeters: number;
	structuredEdgeDeviationMeters: number;
	structuredDenseLengthRatio: number;
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
		pencilRouteRdpTolerance: PENCIL_ROUTE_RDP_TOLERANCE,
		pencilMaxVias: PENCIL_MAX_VIAS,
		pencilSampleSpacingMeters: PENCIL_SAMPLE_SPACING_METERS,
		structuredEdgeDeviationMeters: STRUCTURED_EDGE_DEVIATION_METERS,
		structuredDenseLengthRatio: STRUCTURED_DENSE_LENGTH_RATIO,
		structuredViaSpacingMeters: STRUCTURED_VIA_SPACING_METERS,
		structuredEdgeViaMinMeters: STRUCTURED_EDGE_VIA_MIN_METERS,
		structuredMaxViasPerEdge: STRUCTURED_MAX_VIAS_PER_EDGE,
		structuredCornerInsetMeters: clampCornerInset(cornerInsetMeters)
	};
}

/** Fidelity-only fields (corner inset is independent). */
type FidelityFields = Omit<RoutingOptions, 'structuredCornerInsetMeters'>;

const FIDELITY_PRESETS: Record<RouteFidelity, FidelityFields> = {
	// Coarser pencil, looser structured densify.
	loose: {
		rdpTolerancePencil: 20,
		pencilRouteRdpTolerance: 40,
		pencilMaxVias: 8,
		pencilSampleSpacingMeters: 90,
		structuredEdgeDeviationMeters: 400,
		structuredDenseLengthRatio: 1.6,
		structuredViaSpacingMeters: 450,
		structuredEdgeViaMinMeters: 250,
		structuredMaxViasPerEdge: 10
	},
	// Exact current constants from routing.ts.
	balanced: {
		rdpTolerancePencil: RDP_TOLERANCE_PENCIL,
		pencilRouteRdpTolerance: PENCIL_ROUTE_RDP_TOLERANCE,
		pencilMaxVias: PENCIL_MAX_VIAS,
		pencilSampleSpacingMeters: PENCIL_SAMPLE_SPACING_METERS,
		structuredEdgeDeviationMeters: STRUCTURED_EDGE_DEVIATION_METERS,
		structuredDenseLengthRatio: STRUCTURED_DENSE_LENGTH_RATIO,
		structuredViaSpacingMeters: STRUCTURED_VIA_SPACING_METERS,
		structuredEdgeViaMinMeters: STRUCTURED_EDGE_VIA_MIN_METERS,
		structuredMaxViasPerEdge: STRUCTURED_MAX_VIAS_PER_EDGE
	},
	// Tighter freehand, denser structured vias.
	strict: {
		rdpTolerancePencil: 5,
		pencilRouteRdpTolerance: 12,
		pencilMaxVias: 18,
		pencilSampleSpacingMeters: 40,
		structuredEdgeDeviationMeters: 120,
		structuredDenseLengthRatio: 1.2,
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
