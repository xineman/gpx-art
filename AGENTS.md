# AGENTS.md

Guidance for AI agents working in this repository.

## What this project is

**GPX Art** — a SvelteKit web app where the user draws shapes on a MapLibre map, converts the sketch into a rideable GPX route (via OSRM), and exports it.

This workspace is a **git worktree** of `xineman/gpx-art` on branch `routing-reimpl`. The previous app (sketch tools, routing pipeline, UI panels) was cleared so routing and related features can be reimplemented cleanly. The sibling checkout at `../gpx-art` (branch `main`) is the prior implementation and may be read as reference — **do not edit it from this worktree**.

## Current state

Minimal shell only:

- Full-bleed MapLibre map centered on Warsaw (`src/lib/components/map/`, `src/lib/config/map.ts`)
- OpenFreeMap Liberty vector style
- No sketch tools, routing, GPX export, or floating UI yet

Treat this as a greenfield rebuild that should eventually restore the product behavior of `main`, not a mechanical copy of the old file layout.

## Commands

Package manager is **pnpm** only (`.npmrc` has `engine-strict=true`). Prefer `pnpm <script>`:

| Script           | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| `pnpm dev`       | Vite dev server                                                   |
| `pnpm build`     | Production build                                                  |
| `pnpm preview`   | Preview production build                                          |
| `pnpm check`     | `svelte-kit sync` + `svelte-check` (run after type/runes changes) |
| `pnpm lint`      | Prettier check, then ESLint                                       |
| `pnpm format`    | Prettier write                                                    |
| `pnpm test`      | Unit tests once (`vitest --run`)                                  |
| `pnpm test:unit` | Vitest (watch by default)                                         |

There is no Playwright e2e setup on this branch currently (unlike `main`).

## Stack & conventions

- **SvelteKit 2 + Svelte 5 runes mode** — forced in `vite.config.ts` for non-`node_modules` files. Use `$state`, `$derived`, `$props()`, `$effect`; not legacy stores / `export let`.
- **TypeScript** strict (`tsconfig.json` extends `.svelte-kit/tsconfig.json`).
- **MapLibre GL JS** — client-only. Dynamic-import in components (`await import('maplibre-gl')` + CSS) so SSR never loads it.
- **Tailwind CSS 4** via `@tailwindcss/vite`; global stylesheet is `src/routes/layout.css`.
- **Vitest** for unit + component tests (`src/**/*.{test,spec}.{js,ts}`; `*.svelte.spec.ts` runs in browser via Playwright provider).
- **Prettier**: tabs, single quotes, no trailing commas, 100-col width (`prettier.config.js`). Tailwind class sorting via `prettier-plugin-tailwindcss`.
- **Path alias**: `$lib` → `src/lib`.

## Layout (current)

```
src/
  lib/
    assets/           # static assets (favicon)
    components/map/   # Map.svelte, FullscreenMap.svelte
    config/map.ts     # style URL, Warsaw center/bounds/zoom
    index.ts          # public $lib barrel
  routes/
    +layout.svelte    # favicon + layout.css
    +page.svelte      # FullscreenMap only
    layout.css        # Tailwind import + full-viewport reset
```

Conventions for new code as the app grows:

- Pure domain logic under `src/lib/` (e.g. `routing/`, `geometry/`) with unit tests colocated (`*.test.ts`).
- Map integration under `src/lib/components/map/` or `src/lib/map/` — keep browser-only MapLibre behind client lifecycle (`onMount` / dynamic import).
- Prefer `{ lat, lng }` for app domain points; GeoJSON / MapLibre positions are `[lng, lat]`. Convert at boundaries.
- Shared map constants stay in `src/lib/config/map.ts` (or a future `constants/` module); avoid scattering magic numbers.
- Prefer props over global stores for component state unless cross-tree sharing clearly needs a shared module.

## Routing reimplementation notes

Product goal: sketch → ordered rideable bike route on the road network → GPX.

When reintroducing OSRM:

- Prefer **bike** profile. Public fallback historically used FOSSGIS `https://routing.openstreetmap.de/routed-bike` (fair-use ~1 req/s, identify with a User-Agent). Prefer self-hosted for real load.
- **Do not** use `router.project-osrm.org` as a bike backend — car-only graph; `/bike/` still returns driving.
- Expose the base URL via `PUBLIC_OSRM_BASE_URL` when wiring env.
- Keep OSRM HTTP + geometry helpers pure and testable without Svelte.
- Pipeline stages that existed on `main` (reference only): shape order (TSP), preprocess (pencil densify/RDP vs structured edges), OSRM `/route` (and `/table` for costs), stitch/clean hairpins, GPX export / trim. Reimplement only what is needed, with clear module boundaries and tests.

Read prior art on `main` under `src/lib/routing/` and `src/lib/constants/routing.ts` when design decisions are unclear — then implement the simpler version that fits this branch’s structure.

## Agent workflow

- Prefer small, focused changes; do not restore the entire old tree in one pass.
- After non-trivial TS/Svelte edits, run `pnpm check` (and `pnpm test` when touching logic with tests).
- Do not commit secrets; env files follow `.gitignore` (`.env` ignored, `.env.example` ok).
- Do not edit the sibling `../gpx-art` worktree or force-push shared branches unless the user explicitly asks.
- Keep this file short and actionable; update it when architecture or commands change.
