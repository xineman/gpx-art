import { env } from '$env/dynamic/public';

// Centralised routing constants. The endpoint and profile are the two
// lines to edit when migrating from the OSRM public demo to a self-hosted
// instance, or switching routing modality (car/bike/foot).

// PUBLIC_OSRM_BASE_URL is wired through SvelteKit's $env/dynamic/public so the
// app can target a local osrm-routed Docker container (e.g. port 5050 on macOS
// where 5000 is taken by AirPlay Receiver) without code changes. The public
// router.project-osrm.org demo is kept as the fallback for builds that don't
// define the var — useful for CI / preview deploys.
const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org';

// Bike profile: this app's output is meant to be rideable, so the route
// engine biases toward cycle paths, residential streets, and avoids
// motorways / one-way car restrictions that bikes ignore. OSRM's
// `router.project-osrm.org` exposes the standard `bike` profile built
// from OSM tags; a self-hosted instance can swap to a custom profile
// (e.g. mtb, racing) by editing this constant.
export const OSRM_BASE_URL = env.PUBLIC_OSRM_BASE_URL || DEFAULT_OSRM_BASE_URL;
export const OSRM_PROFILE = 'bike';

// The public OSRM demo server is intentionally small. Its map matching endpoint
// accepts fewer coordinates than /route, so split hand-drawn traces into short
// overlapping chunks and stitch the returned geometries back together.
//
// MATCH_RADIUS_METERS is the per-coordinate standard deviation passed to
// /match as `radiuses=`. Each radius search expands a window over the road
// network and collects candidate edges — radius scales the search area
// quadratically, so this is the dominant lever on /match latency. 30 m
// covers mouse precision (~5 m), touch precision (~15 m), and intentional
// mid-block anchors (~25 m) without exploding candidate counts in dense
// urban areas.
export const MATCH_MAX_POINTS = 10;
export const MATCH_CHUNK_OVERLAP = 2;
export const MATCH_SAMPLE_SPACING_METERS = 60;
export const MATCH_RADIUS_METERS = 30;

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
// handing vertices to OSRM. Drops interior vertices whose perpendicular
// distance from the chord between their kept neighbours is below this
// many meters. Outliers — points that bow sharply off the chord — survive
// because their perpendicular distance exceeds the tolerance.
//
// Two tolerances because the trade-off is shape-specific:
//   - RDP_TOLERANCE        — rectangles / lines / polygons (default 10 m).
//                            These have 2–4 user-clicked vertices, so RDP is
//                            effectively a no-op regardless of value; 10 m
//                            just means "don't drop a corner".
//   - RDP_TOLERANCE_PENCIL — free-form pencil strokes (default 30 m).
//                            10 m keeps most curve points and lets /match
//                            see a noisy trace — slow. 30 m prunes minor
//                            curve wiggles while keeping major inflections
//                            (heart lobes, hairpins, the user's intended
//                            detours). Combined with chunked /match, this
//                            cuts chunk count without flattening the input
//                            shape. /match to real streets further smooths
//                            whatever the simplification removed.
//
// Note on OSRM snapping: we deliberately omit the `radiuses=` parameter
// from the `/route` URL. When omitted, OSRM's default for `/route` is
// effectively unlimited per-waypoint snapping — empirically confirmed on
// router.project-osrm.org (vs. `radiuses=0` which means "exact match
// required" and `radiuses=25` which caps at 25 m). Mid-block and plaza
// anchors reliably fail with `NoSegment` when a finite radius is set, so
// the implicit unlimited default is the right behaviour here.
export const RDP_TOLERANCE = 10;
export const RDP_TOLERANCE_PENCIL = 30;
