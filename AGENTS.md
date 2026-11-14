# AGENTS.md

Guidance for AI agents working in this repository.

## What this project is

**GPX Art** — a SvelteKit web app for sketching shapes on a MapLibre map. Sketches are GeoJSON; **Route** map-matches them to a bike road network (Valhalla) and can export GPX.

## Current state

Working map + drawing + routing shell:

- Full-bleed MapLibre map (OpenFreeMap Liberty)
- Sketch tools: pencil, polyline, polygon, rectangle, pan
- Tools panel with letter shortcuts (`P` / `L` / `G` / `R` / `H`) and Space-to-pan
- Bottom drawing-actions cartridge: undo/redo, sketch GeoJSON I/O, clear, **Download GPX** (when a route is ready), primary **Route**
- **Route pipeline:** client extract guides → topology graph (exact noding, overlap merging, near-endpoint snapping, stub trimming) → Chinese Postman walk per connected component → global via allocation (turning junction passes and dead-end tips mandatory, Douglas–Peucker + densify under one cap) → `POST /api/matrix` for a Valhalla bicycle distance matrix → client-side component-level open-route optimization → `POST /api/route` with one ordered via array → Valhalla `trace_attributes` map matching (`bicycle`) → one retry without unmatched samples → local Valhalla `/route` repair for unowned geometry gaps → display-only detour detection → road line + chevrons + road-attribution ribbon + optional GPX
- Status bar (title, contextual status, sketch distance + point count)
- Completed drawings in a shared GeoJSON feature list; live preview while drafting
- Snapshot undo/redo on the shared `drawings` state instance (bulk import is one undo step)
- Route is derived state on the shared `route` instance; sketch changes invalidate it

Not present yet: manual multi-shape ordering UI, persistence, settings UI (profile/base URL via env).

## Commands

Package manager is **pnpm** only (`.npmrc` has `engine-strict=true`). Prefer `pnpm <script>`:

| Script           | Purpose                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `pnpm dev`       | Vite dev server                                                  |
| `pnpm build`     | Production build                                                 |
| `pnpm preview`   | Preview production build                                         |
| `pnpm check`     | `svelte-kit sync` + `svelte-check` (run with `lint` after edits) |
| `pnpm lint`      | Prettier check, then ESLint (run with `check` after edits)       |
| `pnpm format`    | Prettier write                                                   |
| `pnpm test`      | Unit tests once (`vitest --run`)                                 |
| `pnpm test:unit` | Vitest (watch by default)                                        |

## Stack & conventions

- **SvelteKit 2 + Svelte 5 runes mode** — forced in `vite.config.ts` for non-`node_modules` files. Use `$state`, `$derived`, `$props()`, `$effect`; not legacy stores / `export let`.
- **TypeScript** strict (`tsconfig.json` extends `.svelte-kit/tsconfig.json`).
- **MapLibre GL JS** — client-only. Dynamic-import in `Map.svelte` (`await import('maplibre-gl')` + CSS) so SSR never loads it.
- **Tailwind CSS 4** via `@tailwindcss/vite`. Colors are centralized in `src/routes/layout.css` `@theme static` (`--color-*`, `--shadow-*`). Use `static` so tokens MapLibre reads via `getComputedStyle` are not tree-shaken. Prefer Tailwind utilities in components.
- **Canonical Tailwind classes only** — always write the form IntelliSense `suggestCanonicalClasses` prefers. Prefer theme/spacing-scale utilities over arbitrary values when they produce the same CSS (assume root `1rem = 16px`): e.g. `z-1` not `z-[1]`, `top-4.5` / `left-4.5` not `top-[18px]` / `left-[18px]`, `gap-1.25` not `gap-[5px]`, `w-9.5` not `w-[38px]`, `translate-x-0.75` not `-translate-x-[-3px]` / `translate-y-[-3px]`. Reserve arbitrary `[…]` values for cases with no scale equivalent (e.g. `text-[10px]`, `max-[620px]:…`, `scale-[0.96]`).
- **@lucide/svelte** for tool icons.
- **Vitest** for unit + component tests (`src/**/*.{test,spec}.{js,ts}`; `*.svelte.spec.ts` runs in browser via Playwright provider).
- **Prettier**: tabs, single quotes, no trailing commas, 100-col width (`prettier.config.js`). Tailwind class sorting via `prettier-plugin-tailwindcss`.
- **Path alias**: `#lib` → `src/lib`. Import within a feature (`drawing/`, `routing/`, `map/`) with extensionless relative paths (`'./types'`, `'../route.svelte'`); import across features or from shared folders with `#lib/…` and a `.js` extension (`'#lib/util/pointer.svelte.js'`).

## Layout

```
src/
  lib/
    editor/               # workspace composition across drawing + routing
      FullscreenMap.svelte # full-viewport shell + overlay placement + interaction priority
      EditorToolbar.svelte # sketch history/I/O + route actions
    drawing/              # sketch feature: state, tools, gestures, I/O, and statistics
      drawings.svelte.ts  # completed features + snapshot undo/redo
      tools.svelte.ts     # active tool + Space-to-pan
      status.svelte.ts    # live sketch status (shared flash over draft/tool baseline) + statistics labels
      types.ts           # DrawingFeature + ToolId (no reactive dependencies)
      tools.ts           # tool definitions, hints, and shortcut labels
      components/        # DrawingLayer, tools, sketch actions, status, distance pill
      map/layers.ts      # sketch + live preview sources/layers and preview GeoJSON
      controller.ts      # applies drawing updates to MapLibre and the editor
      map-input.ts       # MapLibre/window listeners → drawing events
      session.ts         # gesture state, draft updates, and commit rules
      draft.ts           # draft types and preview/status projection
      geo.ts             # open/closed LineString helpers and sampling
      io.ts              # GeoJSON sketch parsing and serialization
      stats.ts           # sketch distance and point counts
      tap.ts             # double-tap / re-tap-last helpers (pure)
    routing/             # route feature: state, controls, pipeline, and map presentation
      route.svelte.ts    # accepted route + async lifecycle + GPX download
      routing-options.svelte.ts # session preferences
      config.ts          # client-safe via caps, tolerances, and refinement timeout
      latest-operation.ts # latest-command-wins async coordination
      components/        # RouteLayer, RouteButton, GPX download, move review, road ribbon
      map/               # route/detour layer definitions, sprites, and waypoint hit testing
      presentation/      # accepted route → map GeoJSON
      preparation/       # features → guide paths → topology walks → globally bounded trace vias
      topology/          # guide paths → noded graph → Chinese Postman traversals → walks with mandatory vias
      shape-optimization/ # component traversal candidates, matrix API, route ordering
      matching/          # route response types, client, and server orchestration
      attribution/       # road-edge/span response types and client
      refinement/        # detour analysis, plans, and owned route-refinement.svelte.ts
      export/            # GPX serialization
      providers/valhalla/ # Valhalla trace/matrix/attribute adapters and server config
      api/               # common routing HTTP client, failures, and validation schemas
    map/                 # shared MapLibre infrastructure
      Map.svelte         # client-only map lifecycle
      context.ts         # provideMap / useMap
      config.ts          # style URL, Warsaw center/bounds/zoom
      sources.ts         # shared GeoJSON source updates
      theme.ts           # resolve CSS theme colors for map paint
    geometry/            # shared distance calculations (pure)
    components/ui/       # reusable PanelChrome + TooltipArrow
    util/                # shared pointer, flash message, dismissible-layer, and download helpers
  routes/
    +layout.svelte
    +page.svelte         # mounts editor/FullscreenMap
    api/route/+server.ts # Valhalla map-matching proxy (bicycle by default)
    api/attributes/+server.ts # Valhalla road-attribution proxy for the accepted route
    api/matrix/+server.ts # Valhalla matrix proxy for client-side optimization
    layout.css           # Tailwind + theme tokens + viewport reset
```

**Routing env** (see `.env.example`): `VALHALLA_BASE_URL` (default `https://valhalla1.openstreetmap.de`).

**API reference:** On the dev server, Redoc at `/api/docs` reads `/api/openapi.json`. For each
routing endpoint, keep request validation in `src/routes/api/<endpoint>/contract.server.ts`. Export
`readBody` and `json` for the `+server.ts` handler and `openApiPost` for automatic discovery by the
OpenAPI endpoint, which generates the spec with `zod-openapi`.

## Architecture notes

**Map access.** `Map.svelte` creates the MapLibre instance and `provideMap()`s a reactive handle. Children under the map (e.g. `DrawingLayer`) call `useMap()` — do not pass the map instance through a long prop chain.

**Drawing pipeline.**

1. Reactive application state uses **classes with private mutable rune fields** in `.svelte.ts` modules. Expose computed values as public `readonly $derived` fields instead of forwarding getters; keep getters for mutable state and simple projections. Export one shared instance (`tools`, `drawings`, `route`, `status`, `flash`, `routingOptions`, `pointer`); consumers import it rather than constructing their own. Keep feature state, components, configuration, and tests under `drawing/` or `routing/`; `editor/` composes the features. Ordinary drawing functions import domain types from `drawing/types.ts`, not reactive state modules. Routing raises status-bar messages through `util/flash.svelte.ts`, never `drawing/status.svelte.ts`. Keep cohesive owned state separate: `RouteState` composes `RouteRefinementState` in `routing/refinement/`, which owns waypoint selections, refinement plans, and move-review focus. Pure calculations remain ordinary functions.
2. `MapDrawingInput` translates MapLibre and window events. `DrawingSession` owns drag and vertex gestures and returns updates for `DrawingController` to apply. `DrawingLayer.svelte` wires the controller to runes via `$effect`, commits with `drawings.add(...)`, and feeds live draft geometry into `status`.
3. `drawing/map/layers.ts` owns sketch/preview paint; `routing/map/layers.ts` owns route/detour paint and sprites. Both use shared `map/sources.ts` and `map/theme.ts` helpers. Colors come from `layout.css` theme tokens. Keep pure geometry in `geo.ts` / `geometry/`.
4. `editor/FullscreenMap` owns overlay placement, mounts `ToolShortcuts` once, and supplies drawing hit filtering so route waypoint interactions take priority. It mounts `DrawingLayer` before `RouteLayer` to preserve overlay order. `EditorToolbar` composes sketch and route controls. Tool/action chrome should not self-position with absolute insets or register global keys.
5. `pointer.fineHover` defaults touch-safe (`false`) until client `matchMedia`; status uses long touch hints when coarse, tooltips only when `pointer.ready && fineHover`.

**Coordinates.** MapLibre / GeoJSON positions are `[lng, lat]`. Prefer that form at map boundaries; if app-domain points use `{ lat, lng }`, convert at the edge.

**UI composition.** `FullscreenMap` owns the full-viewport shell: map + drawing layer + floating tools panel. Keep overlays as siblings of `Map` (or children snippets) rather than burying them inside MapLibre controls unless they must be map chrome.

**Conventions for new code:**

- Pure domain logic under `src/lib/` (e.g. `routing/`) with colocated unit tests (`*.test.ts`).
- Keep MapLibre behind client lifecycle (`onMount` / dynamic import / style `load`).
- Map constants stay in `src/lib/map/config.ts`; routing constants stay in `src/lib/routing/config.ts`. Avoid scattering magic numbers.
- Prefer thin Svelte components over putting event/geometry logic in `.svelte` files.
- Do not hardcode colors in components or MapLibre paint. Add tokens in `layout.css` `@theme` and use Tailwind utilities (or CSS variables for MapLibre).
- New/edited Tailwind classes must be canonical (see Stack & conventions); do not introduce avoidable arbitrary values that map to the spacing/z-index scale.

## Agent workflow

- Prefer small, focused changes; extend the existing modules rather than forking parallel patterns.
- After non-trivial TS/Svelte edits, run `pnpm check` and `pnpm lint` (and `pnpm test` when touching logic with tests).
- **Verify UI / map / drawing changes with Codex's in-app Browser when available, otherwise the `/agent-browser` skill** — start `pnpm dev` if needed, exercise the flow in a real browser (load, draw tools, shortcuts), and screenshot or assert the result before calling the work done.
- Do not commit secrets; env files follow `.gitignore` (`.env` ignored, `.env.example` ok).
- Keep this file short and actionable; update it when architecture or commands change on this branch.
