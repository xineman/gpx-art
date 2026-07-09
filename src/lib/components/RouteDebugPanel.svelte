<script lang="ts">
	import type { SketchState } from '$lib/sketch/state.svelte';
	import type { RouteDebugBatch } from '$lib/routing/batchPlan';

	type Props = {
		sketch: SketchState;
		class?: string;
	};
	let { sketch, class: extraClass = '' }: Props = $props();

	// Total point count across all batches — used in the header subtitle.
	// Recomputes when routeDebugBatches changes (i.e. on the next
	// createRoute() call), which is the only time the value can change.
	let totalPoints = $derived(
		sketch.routeDebugBatches.reduce((sum, batch) => sum + batch.points.length, 0)
	);

	// Shape label like "Shape 1" / "Shape 2" (1-based) for friendlier
	// display than the raw 0-based shapeIndex.
	function shapeLabel(batch: RouteDebugBatch): string {
		return `Shape ${batch.shapeIndex + 1}`;
	}

	// One row per chunk for pencil shapes, one row per shape for the
	// rest. The "chunk N of M" suffix is suppressed for structured
	// shapes (single chunk) so the row stays short.
	function chunkLabel(batch: RouteDebugBatch): string {
		if (batch.callKind === 'route') return `${batch.points.length} pts`;
		return `chunk ${batch.chunkIndex + 1}/${batch.chunkCount} · ${batch.points.length} pts`;
	}

	// Toggle handler. Goes through the state's setter so the map repaints
	// in the same frame — a direct field write would only update the
	// reactive state but not the Leaflet markers.
	function onToggle(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		sketch.setRouteDebugVisible(target.checked);
	}

	// Status pill for a batch. The pre-outcome pill was just `match` /
	// `route`; now the per-chunk outcome drives the label and color so the
	// user can see at a glance which /match calls were used as-is and
	// which fell back to /route. The "matched 0.NN" confidence is the
	// most informative single number for "is this match trustworthy?" so
	// it's shown to two decimals (not verbose, and avoids a tooltip).
	//
	// Structured-shape batches keep the blue "route" pill — they have no
	// fallback path and no outcome field.
	type PillStyle = { label: string; classes: string };
	function statusPill(batch: RouteDebugBatch): PillStyle {
		if (batch.callKind === 'route') {
			return { label: 'route', classes: 'bg-[#1d4ed8]/15 text-[#1d4ed8]' };
		}
		const outcome = batch.outcome;
		if (!outcome) {
			// Defensive: a plan that never had attachOutcomes applied (e.g.
			// a future code path that builds the plan before calls return).
			// Falls back to the original callKind pill so the row still
			// reads as something meaningful.
			return { label: batch.callKind, classes: 'bg-[#1e7d62]/15 text-[#1e7d62]' };
		}
		if (outcome.kind === 'matched') {
			return {
				label: `matched ${outcome.confidence.toFixed(2)}`,
				classes: 'bg-emerald-100 text-emerald-800'
			};
		}
		// Fallback. `code` is why sparse /route replaced the match:
		// NoMatch (OSRM reject) or Detour (pathologically long match).
		if (outcome.code === 'Detour') {
			return {
				label: 'fallback · detour',
				classes: 'bg-orange-100 text-orange-800'
			};
		}
		return {
			label: `fallback · ${outcome.code}`,
			classes: 'bg-amber-100 text-amber-800'
		};
	}
</script>

{#if sketch.hasDrawing}
	<section
		class="flex max-h-[280px] w-full max-w-[280px] flex-col gap-[6px] overflow-hidden rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 py-[10px] pr-[12px] pl-[12px] shadow-[0_18px_50px_rgb(27_26_23_/_0.20)] {extraClass}"
		aria-label="OSRM call batches"
	>
		<header class="flex items-center justify-between gap-[10px]">
			<h2 class="text-[12px] font-bold tracking-wide text-[#2c2924] uppercase">OSRM batches</h2>
			<label
				class="flex cursor-pointer items-center gap-[6px] text-[11px] font-bold tracking-wide text-[#2c2924]/75 uppercase"
				title="Overlay /match call batches on the map"
			>
				<input
					type="checkbox"
					checked={sketch.routeDebugVisible}
					onchange={onToggle}
					class="h-[13px] w-[13px] cursor-pointer accent-[#1e7d62]"
				/>
				<span>Show</span>
			</label>
		</header>

		{#if sketch.routeDebugVisible}
			{#if sketch.routeDebugBatches.length > 0}
				<span class="text-[11px] text-[#2c2924]/60">
					{sketch.routeDebugBatches.length} batches · {totalPoints} pts
				</span>
				<ul class="flex flex-col gap-[3px] overflow-y-auto text-[12px] text-[#2c2924]">
					{#each sketch.routeDebugBatches as batch (batch.shapeIndex + '-' + batch.chunkIndex)}
						{@const pill = statusPill(batch)}
						<li class="flex items-center gap-[8px]">
							<span
								aria-hidden="true"
								class="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-sm border border-[#2c2924]/30"
								style="background-color: {batch.color};"
							></span>
							<span class="flex-1 truncate">
								{shapeLabel(batch)}
								<span class="text-[#2c2924]/55">·</span>
								<span class="text-[#2c2924]/75">{chunkLabel(batch)}</span>
							</span>
							<span
								class="rounded-sm px-[5px] py-[1px] text-[10px] font-bold tracking-wide uppercase {pill.classes}"
							>
								{pill.label}
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="m-0 text-[12px] leading-[1.35] text-[#2c2924]/55">
					Click Route to see how your sketch is split across OSRM calls.
				</p>
			{/if}
		{/if}
	</section>
{/if}
