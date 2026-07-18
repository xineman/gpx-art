/**
 * Client-safe routing constants.
 * OSRM base URL lives only on the server (`OSRM_BASE_URL` env).
 */

/** Hard cap on via points per OSRM Route request (public demos are picky). */
export const MAX_VIAS = 60;

/** Douglas–Peucker epsilon in meters before the hard cap. */
export const VIA_SIMPLIFY_TOLERANCE_M = 35;

/** Preferred maximum interval between prepared vias after simplifying the guide path. */
export const VIA_SAMPLE_SPACING_M = 120;

/** Minimum distinct vias needed to call OSRM. */
export const MIN_VIAS = 2;

/** Maximum time spent automatically refining a generated route. */
export const AUTO_REFINE_TIMEOUT_MS = 5_000;
