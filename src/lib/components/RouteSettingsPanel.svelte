<script lang="ts">
	import { Settings } from '@lucide/svelte';
	import {
		CORNER_INSET_DEFAULT_METERS,
		CORNER_INSET_MAX_METERS,
		CORNER_INSET_MIN_METERS,
		ROUTE_FIDELITIES,
		fidelityLabel,
		type RouteFidelity
	} from '$lib/routing/options';
	import { neutralActionButton } from '$lib/constants/styles';
	import type { SketchState } from '$lib/sketch/state.svelte';

	type Props = {
		sketch: SketchState;
		/** Controlled open state from HistoryDock (mutual exclusion). */
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		class?: string;
	};
	let { sketch, open = false, onOpenChange, class: extraClass = '' }: Props = $props();

	const fidelityHint: Record<RouteFidelity, string> = {
		loose: 'Coarser freehand, more road detours OK',
		balanced: 'Default — good for most sketches',
		strict: 'Tighter hug of the sketch (more OSRM work)'
	};

	let menuButton: HTMLButtonElement | undefined = $state();
	let menuElement: HTMLElement | undefined = $state();

	let isNonDefault = $derived(
		sketch.routeFidelity !== 'balanced' || sketch.cornerInsetMeters !== CORNER_INSET_DEFAULT_METERS
	);

	function setOpen(value: boolean) {
		onOpenChange?.(value);
	}

	function toggle() {
		setOpen(!open);
	}

	function onFidelityChange(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (value === 'loose' || value === 'balanced' || value === 'strict') {
			sketch.setRouteFidelity(value);
		}
	}

	function onCornerInput(event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		sketch.setCornerInsetMeters(value);
	}

	function resetDefaults() {
		sketch.setRouteFidelity('balanced');
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
		title="Route settings — fidelity and corner softness"
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
			class="absolute bottom-[calc(100%+6px)] left-0 z-[600] flex w-[min(280px,calc(100vw-36px))] flex-col gap-[10px] rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 py-[10px] pr-[12px] pl-[12px] shadow-[0_18px_50px_rgb(27_26_23_/_0.20)]"
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
					title="Restore Balanced fidelity and default corner inset"
				>
					Reset
				</button>
			</header>

			<label class="flex flex-col gap-[4px]">
				<span class="text-[11px] font-bold tracking-wide text-[#2c2924]/75 uppercase">
					Fidelity
				</span>
				<select
					class="min-h-[32px] cursor-pointer rounded-md border border-[#2c2924]/15 bg-[#efe1b9] px-[8px] text-[13px] font-bold text-[#2c2924] outline-none focus-visible:ring-2 focus-visible:ring-[#1e7d62]/40"
					value={sketch.routeFidelity}
					onchange={onFidelityChange}
					aria-describedby="fidelity-hint"
				>
					{#each ROUTE_FIDELITIES as fidelity (fidelity)}
						<option value={fidelity}>{fidelityLabel(fidelity)}</option>
					{/each}
				</select>
				<span id="fidelity-hint" class="text-[11px] leading-[1.3] text-[#67604f]">
					{fidelityHint[sketch.routeFidelity]}
				</span>
			</label>

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
					title="How far before a geometric corner the route softens (0 = hard corners)"
				/>
				<span class="text-[11px] leading-[1.3] text-[#67604f]">
					Higher softens rectangle/polygon corners on the road network.
				</span>
			</label>

			{#if sketch.phase === 'routed'}
				<p class="m-0 text-[11px] leading-[1.3] text-[#67604f]">
					Re-route to apply changes to the current path.
				</p>
			{/if}
		</section>
	{/if}
</div>
