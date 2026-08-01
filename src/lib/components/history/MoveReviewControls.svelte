<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { route } from '$lib/state/route.svelte';
	import { status } from '$lib/state/status.svelte';
	import { pointer } from '$lib/util/pointer.svelte';

	const waypointIndexes = $derived(route.moveWaypointIndexes);
	const activePosition = $derived(
		Math.max(0, waypointIndexes.indexOf(route.highlightedMoveWaypointIndex ?? -1)) + 1
	);

	function review(offset: number) {
		const waypointIndex = route.reviewMoveWaypoint(offset);
		if (waypointIndex == null) return;
		const position = route.moveWaypointIndexes.indexOf(waypointIndex) + 1;
		status.flash(`Showing proposed move ${position} of ${route.moveWaypointCount}.`);
	}
</script>

{#if route.isReady && !pointer.fineHover && waypointIndexes.length > 1}
	<div
		class="absolute right-0 bottom-full z-3 mb-2 flex items-center gap-0.5 rounded-lg border border-panel-edge/20 bg-panel/95 p-1 text-ink-bright shadow-panel backdrop-blur-sm"
		role="group"
		aria-label="Review proposed waypoint moves"
	>
		<button
			type="button"
			class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-muted transition-colors duration-150 hover:bg-panel-edge/10 hover:text-ink-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70"
			aria-label="Show previous proposed move"
			onclick={() => review(-1)}
		>
			<ChevronLeft size={15} strokeWidth={2.3} />
		</button>

		<span
			class="min-w-18 px-1 text-center font-mono text-[10px] font-semibold tracking-[0.1em] text-ember uppercase"
			aria-live="polite"
		>
			Move {activePosition}/{waypointIndexes.length}
		</span>

		<button
			type="button"
			class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-muted transition-colors duration-150 hover:bg-panel-edge/10 hover:text-ink-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70"
			aria-label="Show next proposed move"
			onclick={() => review(1)}
		>
			<ChevronRight size={15} strokeWidth={2.3} />
		</button>
	</div>
{/if}
