import { describe, expect, test } from 'vitest';
import {
	CORNER_INSET_DEFAULT_METERS,
	CORNER_INSET_MAX_METERS,
	CORNER_INSET_MIN_METERS,
	clampCornerInset,
	defaultRoutingOptions,
	isRouteFidelity,
	resolveRoutingOptions
} from './options';
import {
	DETOUR_RATIO,
	MATCH_FALLBACK_MAX_VIAS,
	MATCH_FALLBACK_RDP_TOLERANCE,
	MATCH_RADIUS_METERS,
	MATCH_RADIUS_WAYPOINT_METERS,
	MATCH_SAMPLE_SPACING_METERS,
	RDP_TOLERANCE_PENCIL,
	STRUCTURED_EDGE_DEVIATION_METERS,
	STRUCTURED_EDGE_VIA_MIN_METERS,
	STRUCTURED_MAX_VIAS_PER_EDGE,
	STRUCTURED_VIA_SPACING_METERS
} from '$lib/constants/routing';

describe('defaultRoutingOptions / balanced fidelity', () => {
	test('matches live constants from routing.ts', () => {
		const opts = defaultRoutingOptions();
		expect(opts).toEqual({
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
			structuredCornerInsetMeters: CORNER_INSET_DEFAULT_METERS
		});
		expect(resolveRoutingOptions('balanced')).toEqual(opts);
	});

	test('loose is coarser than balanced; strict is tighter', () => {
		const loose = resolveRoutingOptions('loose');
		const balanced = resolveRoutingOptions('balanced');
		const strict = resolveRoutingOptions('strict');

		expect(loose.matchFallbackRdpTolerance).toBeGreaterThan(balanced.matchFallbackRdpTolerance);
		expect(strict.matchFallbackRdpTolerance).toBeLessThan(balanced.matchFallbackRdpTolerance);

		expect(loose.detourRatio).toBeGreaterThan(balanced.detourRatio);
		expect(strict.detourRatio).toBeLessThan(balanced.detourRatio);

		expect(loose.structuredEdgeDeviationMeters).toBeGreaterThan(
			balanced.structuredEdgeDeviationMeters
		);
		expect(strict.structuredEdgeDeviationMeters).toBeLessThan(
			balanced.structuredEdgeDeviationMeters
		);

		expect(loose.matchSampleSpacingMeters).toBeGreaterThan(balanced.matchSampleSpacingMeters);
		expect(strict.matchSampleSpacingMeters).toBeLessThan(balanced.matchSampleSpacingMeters);
	});

	test('corner inset is independent of fidelity', () => {
		const a = resolveRoutingOptions('strict', 40);
		const b = resolveRoutingOptions('strict', 180);
		expect(a.structuredCornerInsetMeters).toBe(40);
		expect(b.structuredCornerInsetMeters).toBe(180);
		expect(a.matchFallbackRdpTolerance).toBe(b.matchFallbackRdpTolerance);
	});
});

describe('clampCornerInset', () => {
	test('clamps and rounds', () => {
		expect(clampCornerInset(-10)).toBe(CORNER_INSET_MIN_METERS);
		expect(clampCornerInset(999)).toBe(CORNER_INSET_MAX_METERS);
		expect(clampCornerInset(12.6)).toBe(13);
		expect(clampCornerInset(Number.NaN)).toBe(CORNER_INSET_DEFAULT_METERS);
	});
});

describe('isRouteFidelity', () => {
	test('accepts known values only', () => {
		expect(isRouteFidelity('loose')).toBe(true);
		expect(isRouteFidelity('balanced')).toBe(true);
		expect(isRouteFidelity('strict')).toBe(true);
		expect(isRouteFidelity('medium')).toBe(false);
		expect(isRouteFidelity(null)).toBe(false);
	});
});
