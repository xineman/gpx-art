<script lang="ts">
	import type { SketchState } from '$lib/sketch/state.svelte';

	type Props = {
		sketch: SketchState;
		class?: string;
	};
	let { sketch, class: extraClass = '' }: Props = $props();

	// Total point count across all batches — used in the subtitle.
	// Recomputes when routeDebugBatches changes (i.e. on the next
	// createRoute() call), which is the only time the value can change.
	let totalPoints = $derived(
		sketch.routeDebugBatches.reduce((sum, batch) => sum + batch.points.length, 0)
	);

	// Toggle handler. Goes through the state's setter so the map repaints
	// in the same frame — a direct field write would only update the
	// reactive state but not the debug map markers.
	function onToggle(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		sketch.setRouteDebugVisible(target.checked);
	}
</script>

<!--
	Embedded section for RouteSettingsPanel — lists the last routing plan
	(one waypoint group per shape) and the map-overlay toggle. Not a
	standalone popover; chrome and open/close live on the parent menu.
-->
<div class="flex min-h-0 flex-col gap-[6px] {extraClass}">
	<header class="flex items-center justify-between gap-[10px]">
		<h3 class="m-0 text-[11px] font-bold tracking-wide text-[#2c2924]/75 uppercase">Waypoints</h3>
		<label
			class="flex cursor-pointer items-center gap-[6px] text-[11px] font-bold tracking-wide text-[#2c2924]/75 uppercase"
			title="Show the routing waypoints on the map"
		>
			<input
				type="checkbox"
				checked={sketch.routeDebugVisible}
				onchange={onToggle}
				class="h-[13px] w-[13px] cursor-pointer accent-[#1e7d62]"
			/>
			<span>On map</span>
		</label>
	</header>

	{#if sketch.routeDebugBatches.length > 0}
		<span class="text-[11px] text-[#2c2924]/60">
			{sketch.routeDebugBatches.length}
			{sketch.routeDebugBatches.length === 1 ? 'shape' : 'shapes'} · {totalPoints} points
		</span>
		<ul class="flex max-h-[140px] flex-col gap-[3px] overflow-y-auto text-[12px] text-[#2c2924]">
			{#each sketch.routeDebugBatches as batch (batch.shapeIndex)}
				<li class="flex items-center gap-[8px]">
					<span
						aria-hidden="true"
						class="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-sm border border-[#2c2924]/30"
						style="background-color: {batch.color};"
					></span>
					<span class="flex-1 truncate">
						Shape {batch.shapeIndex + 1}
						<span class="text-[#2c2924]/55">·</span>
						<span class="text-[#2c2924]/75">{batch.points.length} points</span>
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="m-0 text-[11px] leading-[1.3] text-[#67604f]">
			Click Route to see the waypoints used for each shape.
		</p>
	{/if}
</div>
