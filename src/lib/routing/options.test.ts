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
	PENCIL_MAX_VIAS,
	PENCIL_ROUTE_RDP_TOLERANCE,
	PENCIL_SAMPLE_SPACING_METERS,
	RDP_TOLERANCE_PENCIL,
	STRUCTURED_DENSE_LENGTH_RATIO,
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
			pencilRouteRdpTolerance: PENCIL_ROUTE_RDP_TOLERANCE,
			pencilMaxVias: PENCIL_MAX_VIAS,
			pencilSampleSpacingMeters: PENCIL_SAMPLE_SPACING_METERS,
			structuredEdgeDeviationMeters: STRUCTURED_EDGE_DEVIATION_METERS,
			structuredDenseLengthRatio: STRUCTURED_DENSE_LENGTH_RATIO,
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

		expect(loose.pencilRouteRdpTolerance).toBeGreaterThan(balanced.pencilRouteRdpTolerance);
		expect(strict.pencilRouteRdpTolerance).toBeLessThan(balanced.pencilRouteRdpTolerance);

		expect(loose.structuredEdgeDeviationMeters).toBeGreaterThan(
			balanced.structuredEdgeDeviationMeters
		);
		expect(strict.structuredEdgeDeviationMeters).toBeLessThan(
			balanced.structuredEdgeDeviationMeters
		);

		expect(loose.structuredDenseLengthRatio).toBeGreaterThan(balanced.structuredDenseLengthRatio);
		expect(strict.structuredDenseLengthRatio).toBeLessThan(balanced.structuredDenseLengthRatio);

		expect(loose.pencilSampleSpacingMeters).toBeGreaterThan(balanced.pencilSampleSpacingMeters);
		expect(strict.pencilSampleSpacingMeters).toBeLessThan(balanced.pencilSampleSpacingMeters);
	});

	test('corner inset is independent of fidelity', () => {
		const a = resolveRoutingOptions('strict', 40);
		const b = resolveRoutingOptions('strict', 180);
		expect(a.structuredCornerInsetMeters).toBe(40);
		expect(b.structuredCornerInsetMeters).toBe(180);
		expect(a.pencilRouteRdpTolerance).toBe(b.pencilRouteRdpTolerance);
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
