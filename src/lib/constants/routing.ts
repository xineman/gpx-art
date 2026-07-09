import { env } from '$env/dynamic/public';

// Centralised routing constants. Endpoint + profile are the two knobs when
// migrating off the public OSRM demo or switching modality (car/bike/foot).

// PUBLIC_OSRM_BASE_URL targets a local osrm-routed container (e.g. port 5050 on
// macOS where 5000 is AirPlay Receiver). Public demo is the fallback for CI.
const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org';

// Bike profile: rideable output — cycle paths, residential streets; avoids
// motorways / car-only one-ways. Self-hosted instances can swap profiles.
export const OSRM_BASE_URL = env.PUBLIC_OSRM_BASE_URL || DEFAULT_OSRM_BASE_URL;
export const OSRM_PROFILE = 'bike';

// Pencil → sparse hard-via /route. Densify freehand, mild RDP for wiggles,
// then a second RDP + via cap so /route stays cheap and does not weave every
// sample. Full densified traces are never sent as hard vias.
export const PENCIL_SAMPLE_SPACING_METERS = 60;
export const PENCIL_ROUTE_RDP_TOLERANCE = 25;
export const PENCIL_MAX_VIAS = 12;

// Structured shapes (line / polygon / rectangle) always use /route.
//
// Long multi-edge shapes are routed **per sketch edge** (parallel /route
// calls), not as one global via ring. A single /route around a large
// rectangle with a via cap spreads samples too far and OSRM inland-shortcuts.
//
//   - STRUCTURED_EDGE_VIA_MIN_METERS — edge this long may get intermediate vias.
//   - STRUCTURED_VIA_SPACING_METERS — densify spacing when an edge needs vias.
//   - STRUCTURED_MAX_VIAS_PER_EDGE — cap densified vias on one edge.
//   - STRUCTURED_EDGE_DEVIATION_METERS — if A→B stays within this of the edge,
//     keep it; densify only when densified vias improve fit without exploding
//     length (avoids river/park edges where forced vias detour more).
//   - STRUCTURED_DENSE_LENGTH_RATIO — densified edge may be at most this × the
//     simple A→B length.
//   - STRUCTURED_BEARING_RANGE_DEG — OSRM bearings when densifying.
export const STRUCTURED_EDGE_VIA_MIN_METERS = 150;
export const STRUCTURED_VIA_SPACING_METERS = 300;
export const STRUCTURED_MAX_VIAS_PER_EDGE = 16;
export const STRUCTURED_EDGE_DEVIATION_METERS = 250;
export const STRUCTURED_DENSE_LENGTH_RATIO = 1.35;
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

// Eight-hue palette for the OSRM batch debug overlay (see batchPlan).
// ~45° hue steps; skips pure orange/red so drafts (#f26b3a) and trim (#c8412c)
// stay distinct; blues clear of route blue (#1d4ed8). Wraps via modulo.
export const ROUTE_DEBUG_PALETTE: readonly string[] = [
	'#f43f5e', // rose-500
	'#facc15', // yellow-400
	'#84cc16', // lime-500
	'#10b981', // emerald-500
	'#0ea5e9', // sky-500
	'#6366f1', // indigo-500
	'#a855f7', // purple-500
	'#ec4899' // pink-500
];

// Above this cluster count, Held-Karp gives way to nearest-neighbour + 2-opt.
// Held-Karp is O(N²·2ᴺ); at N = 14 that's ~700k ops, <50ms in the browser.
export const TSP_EXACT_LIMIT = 14;

// Route overlay colour — blue-700 — clear against draft orange and dark ink.
export const ROUTE_COLOR = '#1d4ed8';

// Cap on 2-opt iterations so pathological input cannot lock the UI thread.
export const TWO_OPT_MAX_ITERATIONS = 1000;

// Ramer–Douglas–Peucker simplification.
//
//   - RDP_TOLERANCE_PENCIL — freehand preprocess after densify (micro wiggles).
//                            Sparse /route anchors use PENCIL_ROUTE_RDP_*.
//   - RDP_TOLERANCE        — general / retained for callers that need a default.
//
// OSRM /route: omit `radiuses=` so snapping is unlimited (finite radii cause
// NoSegment on mid-block anchors; radiuses=0 means exact match).
export const RDP_TOLERANCE = 10;
export const RDP_TOLERANCE_PENCIL = 10;
