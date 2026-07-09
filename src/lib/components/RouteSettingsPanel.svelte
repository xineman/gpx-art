<script lang="ts">
	import { Settings } from '@lucide/svelte';
	import {
		CORNER_INSET_DEFAULT_METERS,
		CORNER_INSET_MAX_METERS,
		CORNER_INSET_MIN_METERS,
		FIDELITY_LEVEL_DEFAULT,
		FIDELITY_LEVEL_MAX,
		FIDELITY_LEVEL_MIN,
		FIDELITY_LEVEL_STEP,
		fidelityLevelLabel
	} from '$lib/routing/options';
	import { neutralActionButton } from '$lib/constants/styles';
	import type { SketchState } from '$lib/sketch/state.svelte';
	import RouteDebugSection from './RouteDebugSection.svelte';

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

	let isNonDefault = $derived(
		sketch.routeFidelityLevel !== FIDELITY_LEVEL_DEFAULT ||
			sketch.cornerInsetMeters !== CORNER_INSET_DEFAULT_METERS
	);

	function setOpen(value: boolean) {
		onOpenChange?.(value);
	}

	function toggle() {
		setOpen(!open);
	}

	function onFidelityInput(event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		sketch.setRouteFidelityLevel(value);
	}

	function onCornerInput(event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		sketch.setCornerInsetMeters(value);
	}

	function resetDefaults() {
		sketch.setRouteFidelityLevel(FIDELITY_LEVEL_DEFAULT);
		sketch.setCornerInsetMeters(CORNER_INSET_DEFAULT_METERS);
	}

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

<div class="relative {extraClass}">
	<button
		bind:this={menuButton}
		aria-label="Route settings"
		aria-haspopup="dialog"
		aria-expanded={open}
		class="{neutralActionButton} relative {open ? 'bg-[#e6b84a]' : ''}"
		onclick={toggle}
		title="Route settings — how the sketch becomes a ride"
		type="button"
	>
		<Settings size={18} />
		{#if isNonDefault}
			<span
				aria-hidden="true"
				class="absolute top-[5px] right-[5px] h-[7px] w-[7px] rounded-full bg-[#1e7d62] ring-2 ring-[#fff7df]"
				title="Custom settings active"
			></span>
		{/if}
	</button>
	{#if open}
		<section
			bind:this={menuElement}
			class="absolute bottom-[calc(100%+6px)] left-0 z-[600] flex max-h-[min(420px,calc(100vh-120px))] w-[min(280px,calc(100vw-36px))] flex-col gap-[10px] overflow-y-auto rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 py-[10px] pr-[12px] pl-[12px] shadow-[0_18px_50px_rgb(27_26_23_/_0.20)]"
			aria-label="Route settings"
		>
			<header class="flex items-center justify-between gap-[10px]">
				<h2 class="m-0 text-[12px] font-bold tracking-wide text-[#2c2924] uppercase">
					Route settings
				</h2>
				<button
					type="button"
					class="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-bold tracking-wide text-[#1e7d62] uppercase hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
					disabled={!isNonDefault}
					onclick={resetDefaults}
					title="Restore Balanced follow-sketch and default corner softness"
				>
					Reset
				</button>
			</header>

			<div class="flex flex-col gap-[4px]">
				<span class="text-[11px] font-bold tracking-wide text-[#2c2924]/75 uppercase">
					Follow sketch
				</span>
				<input
					type="range"
					min={FIDELITY_LEVEL_MIN}
					max={FIDELITY_LEVEL_MAX}
					step={FIDELITY_LEVEL_STEP}
					value={sketch.routeFidelityLevel}
					oninput={onFidelityInput}
					class="h-[6px] w-full cursor-pointer accent-[#1e7d62]"
					aria-label="Follow sketch fidelity"
					aria-describedby="fidelity-hint"
					aria-valuetext={fidelityLevelLabel(sketch.routeFidelityLevel)}
					title="How tightly the route hugs freehand and long edges"
				/>
				<!-- Map-scale style ticks: named anchors for the continuum. -->
				<div
					class="flex justify-between gap-[4px] text-[10px] font-bold tracking-wide text-[#67604f] uppercase"
					role="group"
					aria-label="Fidelity anchors"
				>
					<button
						type="button"
						class="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-[#1e7d62] {sketch.routeFidelityLevel ===
						FIDELITY_LEVEL_MIN
							? 'text-[#1e7d62]'
							: ''}"
						onclick={() => sketch.setRouteFidelityLevel(FIDELITY_LEVEL_MIN)}
					>
						Loose
					</button>
					<button
						type="button"
						class="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-[#1e7d62] {sketch.routeFidelityLevel ===
						FIDELITY_LEVEL_DEFAULT
							? 'text-[#1e7d62]'
							: ''}"
						onclick={() => sketch.setRouteFidelityLevel(FIDELITY_LEVEL_DEFAULT)}
					>
						Balanced
					</button>
					<button
						type="button"
						class="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-[#1e7d62] {sketch.routeFidelityLevel ===
						FIDELITY_LEVEL_MAX
							? 'text-[#1e7d62]'
							: ''}"
						onclick={() => sketch.setRouteFidelityLevel(FIDELITY_LEVEL_MAX)}
					>
						Strict
					</button>
				</div>
				<span id="fidelity-hint" class="text-[11px] leading-[1.3] text-[#67604f]">
					How tightly the route hugs freehand and long edges.
				</span>
			</div>

			<label class="flex flex-col gap-[4px]">
				<span class="flex items-baseline justify-between gap-[8px]">
					<span class="text-[11px] font-bold tracking-wide text-[#2c2924]/75 uppercase">
						Corner softness
					</span>
					<span class="text-[11px] font-bold text-[#2c2924] tabular-nums">
						{sketch.cornerInsetMeters} m
					</span>
				</span>
				<input
					type="range"
					min={CORNER_INSET_MIN_METERS}
					max={CORNER_INSET_MAX_METERS}
					step={10}
					value={sketch.cornerInsetMeters}
					oninput={onCornerInput}
					class="h-[6px] w-full cursor-pointer accent-[#1e7d62]"
					title="How much rectangle and polygon corners are rounded on the route (0 = sharp)"
				/>
				<span class="text-[11px] leading-[1.3] text-[#67604f]">
					Higher rounds sharp corners so the ride feels smoother.
				</span>
			</label>

			{#if sketch.phase === 'routed' || sketch.phase === 'routing'}
				<p class="m-0 text-[11px] leading-[1.3] text-[#67604f]">
					{#if sketch.phase === 'routing'}
						Updating route with these settings…
					{:else}
						Changes re-route automatically so you can preview immediately.
					{/if}
				</p>
			{/if}

			<div class="border-t border-[#2c2924]/12 pt-[10px]">
				<RouteDebugSection {sketch} />
			</div>
		</section>
	{/if}
</div>
