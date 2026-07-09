# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**GPX Art** — a SvelteKit web app where the user draws shapes on a Leaflet/OSM map, converts the sketch into a rideable GPX route via OSRM, and exports it.

## Commands

Package manager is **pnpm** (engine-strict; `.npmrc` enforces it). Run via `pnpm <script>`:

- `pnpm dev` — Vite dev server
- `pnpm build` — production build
- `pnpm preview` — preview the production build
- `pnpm check` — `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json` (run this after type/runes changes; type errors here block CI)
- `pnpm check:watch` — same, in watch mode
- `pnpm lint` — `prettier --check . && eslint .` (Prettier runs first, then ESLint)
- `pnpm format` — `prettier --write .` (auto-format; safe to run across the whole tree)
- `pnpm test:e2e` — installs Playwright browsers, then runs Playwright tests (the script chains `playwright install && playwright test`)
- `pnpm test` — alias for `test:e2e`

To run a single Playwright test, use the standard `npx playwright test <path>` (the `testMatch` glob is `**/*.e2e.{ts,js}`).

## Stack & conventions

- **SvelteKit 2 + Svelte 5** in runes mode. `svelte.config.js` forces `runes: true` for every file outside `node_modules`, so use `$state`, `$derived`, `$props()`, `$effect` — not the legacy stores/`export let` API.
- **TypeScript** strict mode (`tsconfig.json` extends `.svelte-kit/tsconfig.json`).
- **Leaflet** for the map; loaded with a dynamic `await import('leaflet')` in `src/lib/map/bootstrap.ts` so it never runs server-side. Always import the types as `import type * as Leaflet from 'leaflet'`.
- **Tailwind CSS 4** via `@tailwindcss/vite`. Theme/stylesheet lives in `src/routes/layout.css`; shared component class strings live in `src/lib/constants/styles.ts` (`toolButtonBase`, `neutralActionButton`, `primaryActionButton`).
- **Lucide icons** from `@lucide/svelte`.
- **Playwright** for e2e only; the one example test is at `src/routes/demo/playwright/page.svelte.e2e.ts`.
- Prettier: tabs, single quotes, no trailing comma, 100-col width. Tailwind class sorting is handled by `prettier-plugin-tailwindcss`.

## High-level architecture

The app is a single full-bleed Leaflet map at `src/routes/+page.svelte` with floating UI panels overlaid on top. State lives in one class; map and UI are dumb consumers.

### State (`src/lib/sketch/`)

`state.svelte.ts` exports the `SketchState` class. All reactive fields are Svelte 5 runes:

- `currentTool: Tool` — one of `pan | pencil | line | polygon | rectangle` (defined in `src/lib/types/sketch.ts` as the `TOOLS` const).
- `phase: Phase` — one of `editing | routing | routed`. Most mutations are gated on `phase === 'editing'`.
- `shapes: Shape[]` and `draft: Shape | null` — committed and in-progress shapes; each has a `crypto.randomUUID()` `id`.
- `undoStack: Snapshot[]` capped at 40. `snapshot()` is taken before any state-mutating action; `undo()` restores the previous snapshot.
- `dragOrigin`, `isDragging`, `isSpacePan` — pointer/spacebar state.
- `status`, `routeError` — strings displayed in the status bar / error banner.
- `$derived` fields: `canRoute`, `hasDrawing`, `distanceLabel`, `pointLabel`.

The class also holds **non-reactive** scratch fields (`activePencilShape`, `activeRectangleShape`, `previousTool`) — plain refs that survive across mousedown/mousemove/mouseup without triggering reactivity. The active shape is also pushed into `shapes` (mutated in place + array reassignment) so the renderer redraws on every move.

The map handle is attached after Leaflet finishes loading: `sketch.attachMap({ L, map, drawingLayer })` and detached in the page's `onMount` cleanup. All map events (`mousedown`, `mousemove`, `mouseup`, `click`, `dblclick`, `contextmenu`) are wired in `bootstrap.ts` and forwarded to `handleMap*` methods on the state.

### Derived helpers (`src/lib/sketch/derived.ts`)

Pure functions over a `SketchStateLike` interface (just `shapes` + `draft`) — `routeInputPoints`, `sketchDistance`, `distanceLabel`, `canRoute`. Polygons and rectangles are closed (`closeShape` from `geometry/point.ts`) before being counted.

### Geometry (`src/lib/geometry/`)

- `point.ts` — `toPoint` / `toLatLngs` conversions, `rectanglePoints(start, end)` (returns 4 corners), `resizeRectangle(points, movedIndex, newPoint)` (keeps a rectangle axis-aligned in lat/lng when one corner is dragged), `closeShape`.
- `distance.ts` — Haversine `distanceBetween` in meters (Earth radius 6,371,000 m), `totalDistance`, `formatDistance` (m vs km).

### Map (`src/lib/map/`)

- `bootstrap.ts` — `createMap(el, state)` dynamically imports Leaflet, builds the map with the constants from `src/lib/constants/map.ts` (centered on Warsaw by default at zoom 12), wires event handlers, and returns a `MapController` whose `teardown()` calls `map.off()` then `map.remove()`.
- `renderer.ts` — `renderLayers(L, drawingLayer, shapes, draft, onVertexMove?, canEditCommitted?)` clears the layer group and redraws all shapes. Polygons/rectangles use `L.polygon` with fill; lines/pencils use `L.polyline`. Drafts get orange (`#f26b3a`) stroke and point markers; committed shapes get dark stroke (`#2c2924`). `canEditCommitted(shape)` is the gate that lets callers expose draggable vertex handles on otherwise-committed shapes (line, polygon, and rectangle pass it today; pencil does not).

### Components (`src/lib/components/`)

All four panels take `state: SketchState` as a prop (no store, no context):

- `ToolPalette` — 5 tool buttons (Lucide icons); pan/pencil/line/polygon/rectangle. Disables everything when not in `editing` phase.
- `ActionBar` — Finish / Undo / Clear / Route (or Edit + Export GPX once `phase === 'routed'`).
- `StatusBar` — title, current `status` string, and two pills showing `distanceLabel` and `pointLabel`.
- `ErrorBanner` — renders `state.routeError` if non-empty.

### UI-panel hit-testing during drag

`+page.svelte` overrides Leaflet's normal hit-testing: every panel wrapper has `data-panel="status|palette|action|error"`, and during a drag the panels switch to `pointer-events: none` so map drag events fall through. A `mousemove` listener on the map calls `getBoundingClientRect()` on the cached `panelElements` to figure out which panel (if any) the cursor is over and dims it (`opacity-30`). The cache is built once in `onMount` because `getBoundingClientRect` works regardless of `pointer-events`. If you add a new panel, give its wrapper `data-panel="..."` so the dim-while-dragging effect covers it.

### Constants & types

- `src/lib/constants/map.ts` — `TILE_URL`, `TILE_ATTRIBUTION`, `MAP_CENTER`, `MAP_ZOOM`, `MAX_ZOOM`.
- `src/lib/constants/styles.ts` — shared Tailwind class strings (keep new shared classes here rather than inlining).
- `src/lib/types/sketch.ts` — `Point`, `Tool`, `ShapeType`, `Phase`, `Shape`, `Snapshot`, plus the `TOOLS` and `PHASES` const tuples that drive the type unions.
- `src/lib/tools/names.ts` — `toolName()` for display labels.
- `src/lib/index.ts` — barrel export (re-exports types, PHASES, TOOLS, SketchState).

## Keyboard shortcuts

Implemented in `SketchState.handleKeydown/handleKeyup`:

- `Space` (hold) — temporarily switch to pan tool; previous tool is restored on keyup.
- `Cmd/Ctrl + Z` — undo.
- `Escape` — finish the current draft (same as the `Finish` button / dblclick / right-click).
- `dblclick` and `right-click` on the map also finish the draft.

## Drawing semantics

- **Pencil** — adds a point only if it is >8 m from the last one. A stroke with fewer than 2 points is discarded on `mouseup`. Pencil strokes are not editable after commit.
- **Rectangle** — drag from one corner to the opposite; on `mouseup`, rectangles with diagonal <12 m are discarded. Committed rectangles expose draggable corner handles in every tool; dragging a corner preserves axis-alignment in lat/lng via `resizeRectangle` (opposite corner fixed, adjacent corners repositioned).
- **Line / Polygon** — click to add vertices; requires 2 points (line) or 3 points (polygon) to commit. In-progress draft shows orange with point markers; committing switches to the dark/filled style. Committed line and polygon shapes expose draggable vertex handles in every tool — moving a vertex just repositions that single point.

While a drawing tool is active, mousing down on an existing vertex will start dragging that vertex instead of beginning a new shape. Start new shapes in empty space.

## Routing pipeline (`src/lib/routing/` + `SketchState.createRoute`)

Live end-to-end (not a stub):

1. **TSP order** — `solveClusterTspWithFlip` orders multi-shape visits and may reverse a shape.
2. **Preprocess** — `sampleTrace` densifies long edges; `simplifyRdp` prunes minor wiggles (higher tolerance for pencil).
3. **OSRM**
   - **Pencil** and densified structured shapes (`usesMatchApi`) → chunked `/match` (soft interiors, dual radii, `waypoints=0;N-1`).
   - **Short structured** (few corners) → single `/route` with hard vias.
   - Per match chunk: keep match unless pathologically long (`DETOUR_RATIO` vs sketch + sparse baseline), else sparse `/route`; `NoMatch` also falls back to **sparse** anchors (RDP + max vias), never full densified chunk.
4. **Stitch** — decode polylines; bridge gaps >2 m with `/route`; inter-shape links via `/route`.
5. **Export / trim** — `pointsToGpx`; trim can re-bridge cut endpoints.

Debug: `buildRoutePlan` + `RouteDebugPanel` show per-chunk match/fallback outcomes.

Constants live in `src/lib/constants/routing.ts` (`PUBLIC_OSRM_BASE_URL`, bike profile, radii, detour ratio, etc.).

## Other notes

- `pnpm` is the only supported package manager (`.npmrc` has `engine-strict=true`). Use the local `pnpm-store` (`.pnpm-store/`), not a global cache.
- `playwright.config.ts` boots the preview server on port 4173 with `npm run build && npm run preview` — give it generous time on first run.
- No backend; everything runs client-side. Leaflet tiles come from OpenStreetMap.
- The `demo/` route exists only to host the Playwright example; the real app lives at `/`.
