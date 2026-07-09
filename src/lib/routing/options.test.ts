import { describe, expect, test } from 'vitest';
import {
	CORNER_INSET_DEFAULT_METERS,
	CORNER_INSET_MAX_METERS,
	CORNER_INSET_MIN_METERS,
	FIDELITY_LEVEL_DEFAULT,
	FIDELITY_LEVEL_MAX,
	FIDELITY_LEVEL_MIN,
	clampCornerInset,
	clampFidelityLevel,
	defaultRoutingOptions,
	fidelityLevelLabel,
	fidelityToLevel,
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
		expect(resolveRoutingOptions(FIDELITY_LEVEL_DEFAULT)).toEqual(opts);
	});

	test('level anchors match loose / balanced / strict presets', () => {
		const loose = resolveRoutingOptions(FIDELITY_LEVEL_MIN);
		const balanced = resolveRoutingOptions(FIDELITY_LEVEL_DEFAULT);
		const strict = resolveRoutingOptions(FIDELITY_LEVEL_MAX);

		expect(loose.pencilRouteRdpTolerance).toBe(40);
		expect(loose.pencilMaxVias).toBe(8);
		expect(loose.pencilSampleSpacingMeters).toBe(90);

		expect(balanced).toEqual(defaultRoutingOptions());

		// 2× softer point reduction vs balanced defaults.
		expect(strict.pencilRouteRdpTolerance).toBe(Math.round(PENCIL_ROUTE_RDP_TOLERANCE / 2));
		expect(strict.pencilMaxVias).toBe(PENCIL_MAX_VIAS * 2);
		expect(strict.pencilSampleSpacingMeters).toBe(Math.round(PENCIL_SAMPLE_SPACING_METERS / 2));
		expect(strict.structuredMaxViasPerEdge).toBe(STRUCTURED_MAX_VIAS_PER_EDGE * 2);
	});

	test('loose is coarser than balanced; strict is tighter', () => {
		const loose = resolveRoutingOptions(FIDELITY_LEVEL_MIN);
		const balanced = resolveRoutingOptions(FIDELITY_LEVEL_DEFAULT);
		const strict = resolveRoutingOptions(FIDELITY_LEVEL_MAX);

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

	test('midpoint interpolates between loose and balanced', () => {
		const loose = resolveRoutingOptions(0);
		const mid = resolveRoutingOptions(25);
		const balanced = resolveRoutingOptions(50);

		expect(mid.pencilSampleSpacingMeters).toBeGreaterThan(balanced.pencilSampleSpacingMeters);
		expect(mid.pencilSampleSpacingMeters).toBeLessThan(loose.pencilSampleSpacingMeters);
		expect(mid.pencilMaxVias).toBeGreaterThan(loose.pencilMaxVias);
		expect(mid.pencilMaxVias).toBeLessThan(balanced.pencilMaxVias);
		expect(mid.pencilRouteRdpTolerance).toBeGreaterThan(balanced.pencilRouteRdpTolerance);
		expect(mid.pencilRouteRdpTolerance).toBeLessThan(loose.pencilRouteRdpTolerance);
	});

	test('corner inset is independent of fidelity', () => {
		const a = resolveRoutingOptions(FIDELITY_LEVEL_MAX, 40);
		const b = resolveRoutingOptions(FIDELITY_LEVEL_MAX, 180);
		expect(a.structuredCornerInsetMeters).toBe(40);
		expect(b.structuredCornerInsetMeters).toBe(180);
		expect(a.pencilRouteRdpTolerance).toBe(b.pencilRouteRdpTolerance);
	});
});

describe('clampFidelityLevel', () => {
	test('clamps and rounds', () => {
		expect(clampFidelityLevel(-10)).toBe(FIDELITY_LEVEL_MIN);
		expect(clampFidelityLevel(999)).toBe(FIDELITY_LEVEL_MAX);
		expect(clampFidelityLevel(12.6)).toBe(13);
		expect(clampFidelityLevel(Number.NaN)).toBe(FIDELITY_LEVEL_DEFAULT);
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

describe('fidelity labels and legacy mapping', () => {
	test('fidelityToLevel maps named presets', () => {
		expect(fidelityToLevel('loose')).toBe(0);
		expect(fidelityToLevel('balanced')).toBe(50);
		expect(fidelityToLevel('strict')).toBe(100);
	});

	test('fidelityLevelLabel names anchors and custom midpoints', () => {
		expect(fidelityLevelLabel(0)).toBe('Loose');
		expect(fidelityLevelLabel(50)).toBe('Balanced');
		expect(fidelityLevelLabel(100)).toBe('Strict');
		expect(fidelityLevelLabel(33)).toBe('Custom');
		expect(fidelityLevelLabel(75)).toBe('Custom');
	});

	test('isRouteFidelity accepts known values only', () => {
		expect(isRouteFidelity('loose')).toBe(true);
		expect(isRouteFidelity('balanced')).toBe(true);
		expect(isRouteFidelity('strict')).toBe(true);
		expect(isRouteFidelity('medium')).toBe(false);
		expect(isRouteFidelity(null)).toBe(false);
	});
});
