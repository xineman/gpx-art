# AGENTS.md

Guidance for AI agents working in this repository.

## What this project is

**GPX Art** — a SvelteKit web app for sketching shapes on a MapLibre map. Sketches are stored as GeoJSON and are intended to become rideable GPX routes later; routing is not implemented yet.

## Current state

Working map + drawing shell:

- Full-bleed MapLibre map (OpenFreeMap Liberty)
- Sketch tools: pencil, polyline, polygon, rectangle, pan
- Tools panel with letter shortcuts (`P` / `L` / `G` / `R` / `H`) and Space-to-pan
- Bottom drawing-actions cartridge: undo/redo (`⌘/Ctrl+Z`, `⌘/Ctrl+Shift+Z`, `Ctrl+Y`), sketch file import/export (GeoJSON), clear, and primary **Route** button (UI only for now — no routing yet)
- Status bar (title, contextual status, sketch distance + point count)
- Completed drawings in a shared GeoJSON feature list; live preview while drafting
- Snapshot undo/redo of committed features on `drawings` module runes (bulk import is one undo step)

Not present yet: OSRM / routing, GPX export, multi-shape ordering, persistence, settings UI.

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
- **Path alias**: `$lib` → `src/lib`.

## Layout

```
src/
  lib/
    components/
      map/            # Map.svelte, FullscreenMap.svelte, DrawingLayer.svelte
      tools/          # ToolsPanel.svelte, ToolButton.svelte, ToolShortcuts.svelte
      history/        # HistoryPanel shell + HistoryButtons + DrawingIOMenu
      status/         # StatusBar.svelte
    config/map.ts     # style URL, Warsaw center/bounds/zoom
    drawing/          # framework-agnostic MapLibre draw logic
      controller.ts   # pointer/keyboard interaction → draft/commit
      geo.ts          # LineString / Polygon helpers, sampling
      layers.ts       # GeoJSON sources + fill/line/preview layers
      io.ts           # GeoJSON sketch parse/serialize/download (pure + DOM download)
      tap.ts          # double-tap / re-tap-last helpers (pure)
    geometry/         # haversine distance + sketch stats (pure)
    map/context.ts    # provideMap / useMap (Svelte context)
    state/
      tools.svelte.ts     # active tool + Space-to-pan (module runes)
      drawings.svelte.ts  # completed FeatureCollection + snapshot undo/redo + replaceAll
      status.svelte.ts    # status copy + distance/point labels (module runes)
    util/
      pointer.svelte.ts   # fine-hover vs touch (matchMedia); DEV: window.__gpxArtPointer
    index.ts          # public $lib barrel
  routes/
    +layout.svelte
    +page.svelte      # FullscreenMap only
    layout.css        # Tailwind + theme tokens (sole color palette) + viewport reset
```

## Architecture notes

**Map access.** `Map.svelte` creates the MapLibre instance and `provideMap()`s a reactive handle. Children under the map (e.g. `DrawingLayer`) call `useMap()` — do not pass the map instance through a long prop chain.

**Drawing pipeline.**

1. `tools` / `drawings` / `status` are **module-level runes** (shared singletons). Every importer sees the same signals — use this pattern for cross-tree UI state, not classes with per-import instances.
2. `DrawingController` is framework-agnostic MapLibre event code. `DrawingLayer.svelte` wires it to runes via `$effect`, commits with `drawings.add(...)`, and feeds live draft geometry into `status` for the status bar.
3. `layers.ts` owns source/layer IDs and paint; colors come from `layout.css` theme tokens, not hardcoded hex. Keep pure geometry in `geo.ts` / `geometry/`.
4. `FullscreenMap` owns overlay placement (status + tools stack + bottom history) and mounts `ToolShortcuts` once. Tool/history chrome should not self-position with absolute insets or register global keys.
5. `pointer.fineHover` defaults touch-safe (`false`) until client `matchMedia`; status uses long touch hints when coarse, tooltips only when `pointer.ready && fineHover`.

**Coordinates.** MapLibre / GeoJSON positions are `[lng, lat]`. Prefer that form at map boundaries; if app-domain points use `{ lat, lng }`, convert at the edge.

**UI composition.** `FullscreenMap` owns the full-viewport shell: map + drawing layer + floating tools panel. Keep overlays as siblings of `Map` (or children snippets) rather than burying them inside MapLibre controls unless they must be map chrome.

**Conventions for new code:**

- Pure domain logic under `src/lib/` (e.g. future `routing/`) with colocated unit tests (`*.test.ts`).
- Keep MapLibre behind client lifecycle (`onMount` / dynamic import / style `load`).
- Shared map constants stay in `src/lib/config/map.ts`; avoid scattering magic numbers.
- Prefer thin Svelte components over putting event/geometry logic in `.svelte` files.
- Do not hardcode colors in components or MapLibre paint. Add tokens in `layout.css` `@theme` and use Tailwind utilities (or CSS variables for MapLibre).
- New/edited Tailwind classes must be canonical (see Stack & conventions); do not introduce avoidable arbitrary values that map to the spacing/z-index scale.

## Agent workflow

- Prefer small, focused changes; extend the existing modules rather than forking parallel patterns.
- After non-trivial TS/Svelte edits, run `pnpm check` and `pnpm lint` (and `pnpm test` when touching logic with tests).
- **Verify UI / map / drawing changes with the `/agent-browser` skill** — start `pnpm dev` if needed, exercise the flow in a real browser (load, draw tools, shortcuts), and screenshot or assert the result before calling the work done.
- Do not commit secrets; env files follow `.gitignore` (`.env` ignored, `.env.example` ok).
- Keep this file short and actionable; update it when architecture or commands change on this branch.
