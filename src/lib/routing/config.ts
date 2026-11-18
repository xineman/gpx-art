/**
 * Client-safe routing constants.
 * Valhalla base URL lives only on the server (`VALHALLA_BASE_URL` env).
 */

/** Hard cap on trace points per Valhalla map-matching request (public demos are picky). */
export const MAX_VIAS = 60;

/** Douglas–Peucker epsilon in meters before the hard cap. */
export const VIA_SIMPLIFY_TOLERANCE_M = 35;

/** Preferred maximum interval between prepared vias after simplifying the guide path. */
export const VIA_SAMPLE_SPACING_M = 120;

/** Maximum endpoint-to-path gap inferred as a topology connection. */
export const TOPOLOGY_SNAP_TOLERANCE_M = 10;

/**
 * Smallest turn, in degrees, that makes a walk's pass through a junction a mandatory via. Straighter
 * passes ride through a crossing and are left to simplification like any other point.
 */
export const TOPOLOGY_JUNCTION_TURN_DEG = 30;

/**
 * Largest odd-degree vertex count paired exactly by the Chinese Postman planner. Exact pairing
 * keeps a 2^n table; larger components fall back to greedy pairing with pair-swap improvement.
 */
export const TOPOLOGY_EXACT_MATCHING_LIMIT = 18;

/** Minimum distinct points needed to call Valhalla. */
export const MIN_VIAS = 2;

/** Maximum time spent automatically refining a generated route. */
export const AUTO_REFINE_TIMEOUT_MS = 5_000;

/** Ignore tiny reversals and require near-identical mirrored road geometry. */
export const BACKTRACKING_MIN_LENGTH_M = 30;
export const BACKTRACKING_TOLERANCE_M = 1;
/** Maximum small loop at the end of a retraced stem; larger loops may be intentional. */
export const BACKTRACKING_MAX_TURNAROUND_M = 150;
