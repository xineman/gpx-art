/**
 * Client-safe routing constants.
 * OSRM base URL lives only on the server (`OSRM_BASE_URL` env).
 */

/** Hard cap on via points per OSRM Route request (public demos are picky). */
export const MAX_VIAS = 60;

/** Douglas–Peucker epsilon in meters before the hard cap. */
export const VIA_SIMPLIFY_TOLERANCE_M = 35;

/**
 * After simplify, if still over MAX_VIAS, sample along the path every N meters
 * then stride — this is the fallback spacing target.
 */
export const VIA_SAMPLE_SPACING_M = 120;

/** Minimum distinct vias needed to call OSRM. */
export const MIN_VIAS = 2;
