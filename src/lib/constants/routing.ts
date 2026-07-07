// Centralised routing constants. The endpoint and profile are the two
// lines to edit when migrating from the OSRM public demo to a self-hosted
// instance, or switching routing modality (car/bike/foot).

// Bike profile: this app's output is meant to be rideable, so the route
// engine biases toward cycle paths, residential streets, and avoids
// motorways / one-way car restrictions that bikes ignore. OSRM's
// `router.project-osrm.org` exposes the standard `bike` profile built
// from OSM tags; a self-hosted instance can swap to a custom profile
// (e.g. mtb, racing) by editing this constant.
export const OSRM_BASE_URL = 'https://router.project-osrm.org';
export const OSRM_PROFILE = 'bike';

// The public OSRM demo server is intentionally small. Its map matching endpoint
// accepts fewer coordinates than /route, so split hand-drawn traces into short
// overlapping chunks and stitch the returned geometries back together.
export const MATCH_MAX_POINTS = 10;
export const MATCH_CHUNK_OVERLAP = 2;
export const MATCH_SAMPLE_SPACING_METERS = 60;
export const MATCH_RADIUS_METERS = 70;

// Above this cluster count, the exact Held-Karp bitmask DP gives way to a
// nearest-neighbour + 2-opt heuristic. Held-Karp is O(N²·2ᴺ); at N = 14 that's
// ~700k ops and runs comfortably in <50ms in the browser.
export const TSP_EXACT_LIMIT = 14;

// Route overlay colour — blue-700 — chosen to read clearly against the orange
// draft stroke (#f26b3a) and the dark committed stroke (#2c2924).
export const ROUTE_COLOR = '#1d4ed8';

// Cap on 2-opt iterations. Safety net so a pathological input can't lock the
// UI thread.
export const TWO_OPT_MAX_ITERATIONS = 1000;

// Ramer–Douglas–Peucker simplification tolerance applied per shape before
// handing vertices to OSRM. Drops vertices within this many meters of the
// chord between kept neighbours. At 20 m a typical urban-block pencil
// stroke collapses from ~50 raw vertices to ~6–8 anchors, which is the
// granularity OSRM needs to choose natural streets instead of zigzagging
// around every block.
//
// Note on OSRM snapping: we deliberately omit the `radiuses=` parameter
// from the `/route` URL. When omitted, OSRM's default for `/route` is
// effectively unlimited per-waypoint snapping — empirically confirmed on
// router.project-osrm.org (vs. `radiuses=0` which means "exact match
// required" and `radiuses=25` which caps at 25 m). Mid-block and plaza
// anchors reliably fail with `NoSegment` when a finite radius is set, so
// the implicit unlimited default is the right behaviour here.
export const RDP_TOLERANCE = 20;
