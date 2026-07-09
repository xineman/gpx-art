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
// Pencil routing is route-first (see getMatchedRoute):
//   1. Sparse /route on RDP'd anchors (MATCH_FALLBACK_*) — one fast call.
//   2. Accept if length is within DETOUR_RATIO of the sketch polyline
//      (not a chord shortcut, not a hard-via detour).
//   3. Else escalate to chunked /match (soft HMM). Per-chunk ladder:
//        a. /match OK and not pathologically long → keep it.
//        b. /match too long vs max(L_sketch, L_sparse) → sparse /route (Detour).
//        c. NoMatch → sparse /route (NoMatch).
// Full densified traces are never sent as hard /route vias (weaves/detours).
export const MATCH_MAX_POINTS = 10;
export const MATCH_CHUNK_OVERLAP = 2;
export const MATCH_SAMPLE_SPACING_METERS = 60;
export const MATCH_RADIUS_METERS = 30;
export const MATCH_RADIUS_WAYPOINT_METERS = 100;

// Sparse /route anchors for pencil (primary + match fallback). Mild RDP is
// enough now that /route is primary — we no longer need match-era aggressive
// sparsification. Cap still bounds public-demo URL length / mid-block weave.
export const MATCH_FALLBACK_RDP_TOLERANCE = 25;
export const MATCH_FALLBACK_MAX_VIAS = 12;

// Length-gate ratio for route-first accept and match detour rejection.
// Sparse is rejected (escalate to /match) when L_sketch > ratio × L_sparse
// (chording curves) or L_sparse > ratio × L_sketch (hard-via detour).
// Match is rejected when L_match > ratio × max(L_sketch, L_sparse).
// 1.35 keeps intentional curves while dropping plaza weaves / chords.
export const DETOUR_RATIO = 1.35;

// Structured shapes (line / polygon / rectangle) always use /route — never
// chunked /match. Dense /match at pencil spacing turns a city-scale rectangle
// into dozens of public-demo requests (each multi-second), which is unusable.
//
// Long multi-edge shapes are routed **per sketch edge** (parallel /route
// calls), not as one global via ring. A single /route around a 24 km
// rectangle with a 30-via cap spreads samples ~800 m apart and OSRM takes
// multi-block inland shortcuts between them (route length >> perimeter).
// Per-edge routing forces each side to finish before the next and keeps
// via spacing honest on that side alone.
//
//   - STRUCTURED_EDGE_VIA_MIN_METERS — edge this long may get intermediate vias.
//   - STRUCTURED_VIA_SPACING_METERS — densify spacing when an edge needs vias.
//   - STRUCTURED_MAX_VIAS_PER_EDGE — cap densified vias on one edge.
//   - STRUCTURED_EDGE_DEVIATION_METERS — if a simple A→B /route stays within
//     this max distance of the sketch edge, keep it (no densify). Densify only
//     when the path wanders farther *and* densified vias improve fit without
//     exploding length — avoids river/park edges where forced vias detour more.
//   - STRUCTURED_BEARING_RANGE_DEG — OSRM bearings when densifying.
export const STRUCTURED_EDGE_VIA_MIN_METERS = 150;
export const STRUCTURED_VIA_SPACING_METERS = 300;
export const STRUCTURED_MAX_VIAS_PER_EDGE = 16;
export const STRUCTURED_EDGE_DEVIATION_METERS = 250;
export const STRUCTURED_BEARING_RANGE_DEG = 60;
export const STRUCTURED_MAX_VIAS = STRUCTURED_MAX_VIAS_PER_EDGE;
// Stop each edge this far before the geometric corner and start the next
// edge this far after — then bridge the short corner turn. Prevents hard
// vertex snaps that pull the route off a main street into a local loop.
export const STRUCTURED_CORNER_INSET_METERS = 100;

// Post-process on decoded route geometry: detect *local reverse spurs*
// (via U-turns) and hairpin apexes, then re-call OSRM /route between kept
// endpoints. Hard bridge budget prevents request storms.
export const ROUTE_HAIRPIN_MIN_LEG_METERS = 12;
// Cosine of interior turn: -1 = U-turn, 0 = 90°. Threshold ~120°+ from
// straight-through so intentional rectangle corners (~90°, cos≈0) stay.
export const ROUTE_HAIRPIN_MAX_COSINE = -0.45;
// Reverse-spur / local-detour cleanup.
//
// Two patterns:
//  1) Thin reverse spur — leave a main street, U-turn back near the same point
//     (Parkowa). chord small, pathLen ≈ 2× reach.
//  2) Corner approach loop — wander in a neighborhood to hit a geometric
//     vertex, rejoin further along (NW Powązkowska mess). chord larger
//     (up to LOCAL_DETOUR_NEAR), path still wasteful vs chord.
//
// MAX_METERS caps so a full rectangle tour is never collapsed.
export const ROUTE_LOOP_NEAR_METERS = 90;
export const ROUTE_LOOP_MIN_METERS = 80;
export const ROUTE_LOOP_MAX_METERS = 900;
export const ROUTE_LOOP_WINDOW = 140;
export const ROUTE_SPUR_MIN_PATH_TO_REACH = 1.65;
export const ROUTE_SPUR_MAX_PATH_TO_REACH = 3.15;
export const ROUTE_SPUR_MIN_DETOUR = 2.2;
// Wider local detours (corner approach loops).
export const ROUTE_LOCAL_DETOUR_NEAR_METERS = 220;
export const ROUTE_LOCAL_DETOUR_MIN_METERS = 150;
export const ROUTE_LOCAL_DETOUR_MIN_RATIO = 1.65; // pathLen / chord
// Sketch-corner neighborhood: if the route spends this much path length
// inside CORNER_RADIUS of a geometric vertex while entry→exit chord is short,
// collapse the visit (Powązkowska-style corner approach loops).
export const ROUTE_CORNER_RADIUS_METERS = 350;
export const ROUTE_CORNER_MIN_PATH_METERS = 160;
export const ROUTE_CORNER_MIN_PATH_TO_CHORD = 1.35;
export const ROUTE_CLEAN_MAX_BRIDGES = 12;
export const ROUTE_CLEAN_SPANS_PER_PASS = 6;

// When building GTSP transition costs, prefer OSRM /table road distances for
// this many shapes or fewer (and at least 2). Larger N falls back to haversine
// to bound pre-route latency.
export const TSP_ROAD_COST_LIMIT = 8;

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

// Ramer–Douglas–Peucker simplification tolerances.
//
//   - RDP_TOLERANCE_PENCIL — free-form pencil preprocess after densify.
//                            Mild (10 m): only micro freehand wiggles. Sparse
//                            /route has its own anchors (MATCH_FALLBACK_*);
//                            denser points help sketch-length gates and rare
//                            /match escalation. Was 30 m when /match was primary.
//   - RDP_TOLERANCE        — retained for sparse-fallback / future structured
//                            use. Structured shapes no longer RDP densified
//                            samples (that collapsed long straight edges).
//
// Note on OSRM snapping: we deliberately omit the `radiuses=` parameter
// from the `/route` URL. When omitted, OSRM's default for `/route` is
// effectively unlimited per-waypoint snapping — empirically confirmed on
// router.project-osrm.org (vs. `radiuses=0` which means "exact match
// required" and `radiuses=25` which caps at 25 m). Mid-block and plaza
// anchors reliably fail with `NoSegment` when a finite radius is set, so
// the implicit unlimited default is the right behaviour here.
export const RDP_TOLERANCE = 10;
export const RDP_TOLERANCE_PENCIL = 10;
