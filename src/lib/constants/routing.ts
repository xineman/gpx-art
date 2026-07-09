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
// Two per-coordinate radii because /match treats the chunk's first and last
// anchors as mandatory waypoints (`waypoints=0;N-1`) and the rest as HMM
// tracepoints. A waypoint failing to snap within its radius returns
// `NoMatch` for the entire chunk, so waypoints deserve a more forgiving
// radius than tracepoints:
//
//   - MATCH_RADIUS_METERS (30) — per-coordinate radius for tracepoints
//     inside the chunk (indices 1..N-2). Sent as the interior values of
//     `radiuses=`. Covers mouse precision (~5 m), touch precision (~15 m),
//     and intentional mid-block anchors (~25 m) without exploding
//     candidate counts in dense urban areas.
//
//   - MATCH_RADIUS_WAYPOINT_METERS (100) — per-coordinate radius for the
//     chunk's first and last coordinate (the waypoints). Sent as the first
//     and last values of `radiuses=`. Anchors landing 25-50 m from any road
//     — plaza boundaries, park entrances, recently edited OSM data — still
//     snap at this radius, so /match doesn't reject the whole chunk on
//     `NoMatch`. Tracepoints stay at 30 m for fast HMM.
//
// OSRM /match also reports a per-matching `confidence` score, but the score
// reflects HMM hypothesis-spread (how many plausible candidate roads the
// chunk could match) rather than route usability. Pencil traces are
// systematically low-confidence even when the matched geometry is correct,
// because the tracepoints are collinear — every nearby road looks equally
// plausible. We therefore never reject a match on confidence alone.
//
// Fallback ladder (per chunk):
//   1. /match succeeds and length is not pathologically inflated → keep it.
//   2. /match succeeds but L_match > DETOUR_RATIO * max(L_sketch, L_sparse)
//      → sparse /route (code: Detour). Catches station/plaza weaves.
//   3. /match returns NoMatch → sparse /route (code: NoMatch).
// Sparse /route uses RDP'd anchors (MATCH_FALLBACK_*), never the full densified
// chunk — full-chunk /route turns soft tracepoints into hard vias and detours.
export const MATCH_MAX_POINTS = 10;
export const MATCH_CHUNK_OVERLAP = 2;
export const MATCH_SAMPLE_SPACING_METERS = 60;
export const MATCH_RADIUS_METERS = 30;
export const MATCH_RADIUS_WAYPOINT_METERS = 100;

// Sparse /route fallback after NoMatch or detour rejection. Higher RDP than
// pencil preprocessing so only major corners survive as hard vias; cap keeps
// public-demo /route URLs short and prevents mid-block weave.
export const MATCH_FALLBACK_RDP_TOLERANCE = 50;
export const MATCH_FALLBACK_MAX_VIAS = 6;

// Matched geometry is rejected when longer than this factor times
// max(sketch polyline length, sparse-route length). 1.35 keeps intentional
// curves (heart lobes, U-turns) while dropping multi-block plaza loops.
export const DETOUR_RATIO = 1.35;

// Structured shapes (line / polygon / rectangle) use /route when the
// processed point list is short (corners only). Once densified edges leave
// this many points, switch to /match so long sides follow the drawn edge
// softly instead of taking a faster arterial between corners.
export const STRUCTURED_MATCH_MIN_POINTS = 6;

// Eight-hue palette used by the /match batch debug overlay (see
// $lib/routing/batchPlan). Each batch of points the routing pipeline sends to
// OSRM gets a distinct color from this list so the user can see at a glance
// which sketch points went into which /match call.
//
// Distribution: spans the full hue wheel in ~45° steps for maximum
// perceptual distance. Hue zones that would clash with the existing reserved
// palette (orange draft #f26b3a, vermilion trim #c8412c) are skipped — instead
// of pure orange/red we lead with rose (slightly toward magenta) and a deeper
// amber-yellow, which read as warm but distinct from the draft orange. The
// blues are kept well clear of the routed-polyline blue (#1d4ed8): sky-500
// (brighter, more cyan) for batch blues, indigo-500 (slightly violet) for
// the deepest blue batch. Palettes wrap via modulo — beyond 8 batches the
// colors repeat, and the batch index in the legend disambiguates.
export const MATCH_DEBUG_PALETTE: readonly string[] = [
	'#f43f5e', // rose-500   — warm red, away from vermilion
	'#facc15', // yellow-400 — bright amber, away from draft orange
	'#84cc16', // lime-500   — yellow-green
	'#10b981', // emerald-500 — clean green
	'#0ea5e9', // sky-500    — bright cyan-blue, away from route blue
	'#6366f1', // indigo-500 — blue-violet
	'#a855f7', // purple-500 — vivid purple
	'#ec4899' // pink-500    — hot magenta
];

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
