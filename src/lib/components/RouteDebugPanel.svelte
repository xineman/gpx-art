<script lang="ts">
	import { Layers } from '@lucide/svelte';
	import { neutralActionButton } from '$lib/constants/styles';
	import type { SketchState } from '$lib/sketch/state.svelte';
	import type { RouteDebugBatch } from '$lib/routing/batchPlan';

	type Props = {
		sketch: SketchState;
		/** Controlled open state from HistoryDock (mutual exclusion). */
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		class?: string;
	};
	let { sketch, open = false, onOpenChange, class: extraClass = '' }: Props = $props();

	let menuButton: HTMLButtonElement | undefined = $state();
	let menuElement: HTMLElement | undefined = $state();

	// Total point count across all batches — used in the header subtitle.
	// Recomputes when routeDebugBatches changes (i.e. on the next
	// createRoute() call), which is the only time the value can change.
	let totalPoints = $derived(
		sketch.routeDebugBatches.reduce((sum, batch) => sum + batch.points.length, 0)
	);

	function setOpen(value: boolean) {
		onOpenChange?.(value);
	}

	function toggle() {
		setOpen(!open);
	}

	// Shape label like "Shape 1" / "Shape 2" (1-based) for friendlier
	// display than the raw 0-based shapeIndex.
	function shapeLabel(batch: RouteDebugBatch): string {
		return `Shape ${batch.shapeIndex + 1}`;
	}

	function batchLabel(batch: RouteDebugBatch): string {
		return `${batch.points.length} pts`;
	}

	// Toggle handler. Goes through the state's setter so the map repaints
	// in the same frame — a direct field write would only update the
	// reactive state but not the Leaflet markers.
	function onToggle(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		sketch.setRouteDebugVisible(target.checked);
	}

	const routePill = { label: 'route', classes: 'bg-[#1d4ed8]/15 text-[#1d4ed8]' };

	// Outside click + Escape. Same pattern as FileMenu.
	$effect(() => {
		if (!open) return;
		function onPointer(event: MouseEvent) {
			const target = event.target as Node | null;
			if (!target) return;
			if (menuElement?.contains(target)) return;
			if (menuButton?.contains(target)) return;
			setOpen(false);
		}
		function onKey(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.stopPropagation();
				setOpen(false);
				menuButton?.focus();
			}
		}
		document.addEventListener('mousedown', onPointer);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onPointer);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

{#if sketch.hasDrawing}
	<div class="relative {extraClass}">
		<button
			bind:this={menuButton}
			aria-label="OSRM batches"
			aria-haspopup="dialog"
			aria-expanded={open}
			class="{neutralActionButton} {open ? 'bg-[#e6b84a]' : ''}"
			onclick={toggle}
			title="OSRM call batches — waypoints sent per /route call"
			type="button"
		>
			<Layers size={18} />
		</button>
		{#if open}
			<section
				bind:this={menuElement}
				class="absolute right-0 bottom-[calc(100%+6px)] z-[600] flex max-h-[280px] w-[min(280px,calc(100vw-36px))] flex-col gap-[6px] overflow-hidden rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 py-[10px] pr-[12px] pl-[12px] shadow-[0_18px_50px_rgb(27_26_23_/_0.20)]"
				aria-label="OSRM call batches"
			>
				<header class="flex items-center justify-between gap-[10px]">
					<h2 class="m-0 text-[12px] font-bold tracking-wide text-[#2c2924] uppercase">
						OSRM batches
					</h2>
					<label
						class="flex cursor-pointer items-center gap-[6px] text-[11px] font-bold tracking-wide text-[#2c2924]/75 uppercase"
						title="Overlay OSRM call batches on the map"
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

				{#if sketch.routeDebugBatches.length > 0}
					<span class="text-[11px] text-[#2c2924]/60">
						{sketch.routeDebugBatches.length} batches · {totalPoints} pts
					</span>
					<ul class="flex flex-col gap-[3px] overflow-y-auto text-[12px] text-[#2c2924]">
						{#each sketch.routeDebugBatches as batch (batch.shapeIndex + '-' + batch.chunkIndex)}
							<li class="flex items-center gap-[8px]">
								<span
									aria-hidden="true"
									class="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-sm border border-[#2c2924]/30"
									style="background-color: {batch.color};"
								></span>
								<span class="flex-1 truncate">
									{shapeLabel(batch)}
									<span class="text-[#2c2924]/55">·</span>
									<span class="text-[#2c2924]/75">{batchLabel(batch)}</span>
								</span>
								<span
									class="rounded-sm px-[5px] py-[1px] text-[10px] font-bold tracking-wide uppercase {routePill.classes}"
								>
									{routePill.label}
								</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="m-0 text-[12px] leading-[1.35] text-[#2c2924]/55">
						Click Route to see how your sketch is split across OSRM calls.
					</p>
				{/if}
			</section>
		{/if}
	</div>
{/if}
