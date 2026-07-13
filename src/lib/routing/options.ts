import {
	PENCIL_MAX_VIAS,
	PENCIL_ROUTE_RDP_TOLERANCE,
	PENCIL_SAMPLE_SPACING_METERS,
	RDP_TOLERANCE_PENCIL,
	STRUCTURED_CORNER_INSET_METERS,
	STRUCTURED_EDGE_VIA_MIN_METERS,
	STRUCTURED_VIA_SPACING_METERS
} from '$lib/constants/routing';

/**
 * Legacy named stops (localStorage migration + anchor labels).
 * Live UI uses a continuous 0–100 fidelity level.
 */
export const ROUTE_FIDELITIES = ['loose', 'balanced', 'strict'] as const;
export type RouteFidelity = (typeof ROUTE_FIDELITIES)[number];

/** Continuous follow-sketch level: 0 = loose, 50 = balanced, 100 = strict. */
export const FIDELITY_LEVEL_MIN = 0;
export const FIDELITY_LEVEL_MAX = 100;
export const FIDELITY_LEVEL_DEFAULT = 50;
export const FIDELITY_LEVEL_STEP = 1;

/**
 * Tunable routing knobs for the unified densify → hard-via /route pipeline.
 * Infrastructure limits (clean bridge budget, TSP caps, anchor hard caps)
 * stay in routing.ts.
 */
export type RoutingOptions = {
	rdpTolerancePencil: number;
	pencilRouteRdpTolerance: number;
	pencilMaxVias: number;
	pencilSampleSpacingMeters: number;
	/** Mid-edge re-pin spacing on long geometric chords after RDP. */
	structuredViaSpacingMeters: number;
	/** Edges at least this long get intermediate vias after RDP. */
	structuredEdgeViaMinMeters: number;
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
		structuredViaSpacingMeters: STRUCTURED_VIA_SPACING_METERS,
		structuredEdgeViaMinMeters: STRUCTURED_EDGE_VIA_MIN_METERS,
		structuredCornerInsetMeters: clampCornerInset(cornerInsetMeters)
	};
}

/** Fidelity-only fields (corner inset is independent). */
type FidelityFields = Omit<RoutingOptions, 'structuredCornerInsetMeters'>;

const FIDELITY_PRESETS: Record<RouteFidelity, FidelityFields> = {
	loose: {
		rdpTolerancePencil: 20,
		pencilRouteRdpTolerance: 40,
		pencilMaxVias: 8,
		pencilSampleSpacingMeters: 90,
		structuredViaSpacingMeters: 450,
		structuredEdgeViaMinMeters: 250
	},
	balanced: {
		rdpTolerancePencil: RDP_TOLERANCE_PENCIL,
		pencilRouteRdpTolerance: PENCIL_ROUTE_RDP_TOLERANCE,
		pencilMaxVias: PENCIL_MAX_VIAS,
		pencilSampleSpacingMeters: PENCIL_SAMPLE_SPACING_METERS,
		structuredViaSpacingMeters: STRUCTURED_VIA_SPACING_METERS,
		structuredEdgeViaMinMeters: STRUCTURED_EDGE_VIA_MIN_METERS
	},
	strict: {
		rdpTolerancePencil: Math.max(1, Math.round(RDP_TOLERANCE_PENCIL / 2)),
		pencilRouteRdpTolerance: Math.max(1, Math.round(PENCIL_ROUTE_RDP_TOLERANCE / 2)),
		pencilMaxVias: PENCIL_MAX_VIAS * 2,
		pencilSampleSpacingMeters: Math.max(1, Math.round(PENCIL_SAMPLE_SPACING_METERS / 2)),
		structuredViaSpacingMeters: Math.max(1, Math.round(STRUCTURED_VIA_SPACING_METERS / 2)),
		structuredEdgeViaMinMeters: Math.max(1, Math.round(STRUCTURED_EDGE_VIA_MIN_METERS / 2))
	}
};

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function lerpFidelityFields(a: FidelityFields, b: FidelityFields, t: number): FidelityFields {
	const meters = (key: keyof FidelityFields) => Math.round(lerp(a[key], b[key], t));
	return {
		rdpTolerancePencil: meters('rdpTolerancePencil'),
		pencilRouteRdpTolerance: meters('pencilRouteRdpTolerance'),
		pencilMaxVias: Math.max(2, meters('pencilMaxVias')),
		pencilSampleSpacingMeters: Math.max(1, meters('pencilSampleSpacingMeters')),
		structuredViaSpacingMeters: Math.max(1, meters('structuredViaSpacingMeters')),
		structuredEdgeViaMinMeters: Math.max(1, meters('structuredEdgeViaMinMeters'))
	};
}

/** Interpolate between loose ↔ balanced ↔ strict for a 0–100 level. */
function interpolateFidelityFields(level: number): FidelityFields {
	const n = clampFidelityLevel(level);
	if (n <= FIDELITY_LEVEL_DEFAULT) {
		const t = n / FIDELITY_LEVEL_DEFAULT;
		return lerpFidelityFields(FIDELITY_PRESETS.loose, FIDELITY_PRESETS.balanced, t);
	}
	const t = (n - FIDELITY_LEVEL_DEFAULT) / (FIDELITY_LEVEL_MAX - FIDELITY_LEVEL_DEFAULT);
	return lerpFidelityFields(FIDELITY_PRESETS.balanced, FIDELITY_PRESETS.strict, t);
}

export function resolveRoutingOptions(
	fidelityLevel: number = FIDELITY_LEVEL_DEFAULT,
	cornerInsetMeters = CORNER_INSET_DEFAULT_METERS
): RoutingOptions {
	return {
		...interpolateFidelityFields(fidelityLevel),
		structuredCornerInsetMeters: clampCornerInset(cornerInsetMeters)
	};
}

export function clampFidelityLevel(level: number): number {
	if (!Number.isFinite(level)) return FIDELITY_LEVEL_DEFAULT;
	return Math.max(FIDELITY_LEVEL_MIN, Math.min(FIDELITY_LEVEL_MAX, Math.round(level)));
}

export function clampCornerInset(meters: number): number {
	if (!Number.isFinite(meters)) return CORNER_INSET_DEFAULT_METERS;
	return Math.max(CORNER_INSET_MIN_METERS, Math.min(CORNER_INSET_MAX_METERS, Math.round(meters)));
}

/** Map legacy named fidelity to a continuous level. */
export function fidelityToLevel(fidelity: RouteFidelity): number {
	switch (fidelity) {
		case 'loose':
			return FIDELITY_LEVEL_MIN;
		case 'balanced':
			return FIDELITY_LEVEL_DEFAULT;
		case 'strict':
			return FIDELITY_LEVEL_MAX;
	}
}

export function isRouteFidelity(value: unknown): value is RouteFidelity {
	return value === 'loose' || value === 'balanced' || value === 'strict';
}

/** Readout for the slider: named only at exact anchors. */
export function fidelityLevelLabel(level: number): 'Loose' | 'Balanced' | 'Strict' | 'Custom' {
	const n = clampFidelityLevel(level);
	if (n === FIDELITY_LEVEL_MIN) return 'Loose';
	if (n === FIDELITY_LEVEL_DEFAULT) return 'Balanced';
	if (n === FIDELITY_LEVEL_MAX) return 'Strict';
	return 'Custom';
}
