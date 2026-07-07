<script lang="ts">
	import { Check, Scissors, X } from '@lucide/svelte';
	import { fade, scale } from 'svelte/transition';
	import type { SketchState } from '$lib/sketch/state.svelte';

	type Props = {
		sketch: SketchState;
		class?: string;
	};
	let { sketch, class: extraClass = '' }: Props = $props();

	// Three steps in the trim flow. Step 0 = "Mark start" (no picks set),
	// step 1 = "Mark end" (only trimStart set), step 2 = "Confirm" (both
	// picks set). Drives the highlight + arrow flow in the indicator.
	type TrimStep = { label: string };
	const trimSteps: TrimStep[] = [
		{ label: 'Mark start' },
		{ label: 'Mark end' },
		{ label: 'Confirm' }
	];

	let trimStepIndex = $derived.by(() => {
		if (!sketch.trimMode) return -1;
		if (sketch.trimStart === null) return 0;
		if (sketch.trimEnd === null) return 1;
		return 2;
	});

	// Fallback hint text when state.trimHint is empty (e.g. between
	// modes). Keeping the fallback in the component means the panel is
	// always informative on entry, even before the state setter fires.
	const defaultHint = 'Mark both ends of the stretch you want to remove.';
</script>

{#if sketch.trimMode}
	<section
		class="relative flex w-full max-w-[calc(100vw-36px)] flex-col gap-[8px] overflow-hidden rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 py-[11px] pr-[14px] pl-[20px] shadow-[0_18px_50px_rgb(27_26_23_/_0.20)] max-[620px]:gap-[7px] max-[620px]:py-[9px] max-[620px]:pr-[12px] max-[620px]:pl-[16px] {extraClass}"
		aria-label="Trim instructions"
		data-panel="trim"
	>
		<!--
			Red left stripe: the panel's signature element. Reads as a
			teacher's red pen mark down the side of a notebook page — a
			deliberate, on-brief accent rather than a generic "danger"
			alert. Sits inside the rounded panel (overflow-hidden) so its
			rounded ends meet the panel's own corners cleanly.
		-->
		<div
			aria-hidden="true"
			class="pointer-events-none absolute inset-y-[7px] left-[6px] w-[3px] rounded-full bg-[#c8412c]/85"
		></div>

		<header class="flex items-center gap-[8px]">
			<Scissors size={15} color="#c8412c" strokeWidth={2.4} aria-hidden="true" />
			<h2
				class="m-0 font-serif text-[14px] leading-none font-bold tracking-[0.01em] text-[#2c2924]"
			>
				Trimming the route
			</h2>
		</header>

		<p class="m-0 text-[12px] leading-[1.35] text-[#67604f]">
			{sketch.trimHint || defaultHint}
		</p>

		<!--
			Single action row. The three steps ARE the action surface:
			cancel as icon-only ✕ on the left, then a flowing
			① → ② → ③ indicator. When both picks are set, step ③
			transforms from a muted future step into the primary Confirm
			button (green, with a soft shadow) — a small moment of
			"the system knows I'm done."
		-->
		<div class="mt-[1px] flex flex-wrap items-center gap-[6px]" role="group" aria-label="Trim flow">
			<!--
				Cancel: icon-only ✕, sized to match the step pills so the
				row sits on one visual baseline. The aria-label and
				tooltip are the only words — the X icon does the talking.
			-->
			<button
				type="button"
				aria-label="Cancel trim"
				title="Cancel trim"
				onclick={() => sketch.cancelTrim()}
				class="inline-flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#2c2924]/15 bg-transparent text-[#2c2924]/65 transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-[#2c2924]/30 hover:bg-[#2c2924]/[0.08] hover:text-[#2c2924] active:translate-y-px"
			>
				<X size={15} strokeWidth={2.4} />
			</button>

			<ol class="m-0 flex list-none flex-wrap items-center gap-[6px] p-0" aria-label="Steps">
				{#each trimSteps as step, i (step.label)}
					{@const isConfirm = i === 2}
					{@const isActive = i === trimStepIndex}
					{@const isPast = i < trimStepIndex}
					{@const canConfirm = isConfirm && sketch.trimStart !== null && sketch.trimEnd !== null}

					<li class="flex items-center">
						{#if isConfirm && canConfirm}
							<!--
								Step ③ has graduated from "future step" to
								"primary action". Same height as the
								cancel button and the other pills, but
								green to match the rest of the app's
								primary action vocabulary. A soft green
								shadow signals depth — the button has
								"arrived". The scale+fade transition
								makes the moment legible without being
								theatrical.
							-->
							<button
								in:scale={{ duration: 180, start: 0.94, opacity: 0 }}
								type="button"
								aria-label="Confirm trim"
								title="Confirm trim"
								onclick={() => {
									void sketch.applyTrim();
								}}
								class="inline-flex h-[28px] cursor-pointer items-center gap-[6px] rounded-md border border-[#1e7d62] bg-[#1e7d62] px-[9px] text-[11px] leading-none font-bold tracking-[0.05em] text-[#fff7df] uppercase shadow-[0_2px_6px_rgb(30_125_98_/_0.25)] transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out hover:border-[#155d49] hover:bg-[#155d49] active:translate-y-px"
							>
								<Check size={14} strokeWidth={2.6} />
								<span>Confirm</span>
							</button>
						{:else}
							<!--
								Static step indicator. Same 28px height
								as the active Confirm button so the row
								doesn't jump when step ③ transitions.
								The out:fade on the third pill handles
								a graceful cross-fade into the Confirm
								button; for steps ① and ② the directive
								is dormant (they never unmount).
							-->
							<span
								out:fade={{ duration: 100 }}
								aria-current={isActive ? 'step' : undefined}
								class="inline-flex h-[28px] items-center gap-[6px] rounded-md border px-[9px] text-[11px] leading-none font-bold tracking-[0.05em] uppercase transition-colors duration-150 {isActive
									? 'border-[#c8412c] bg-[#c8412c]/10 text-[#c8412c]'
									: isPast
										? 'border-[#2c2924]/15 bg-[#2c2924]/5 text-[#2c2924]/70'
										: 'border-[#2c2924]/15 bg-transparent text-[#2c2924]/40'}"
							>
								<span
									aria-hidden="true"
									class="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border border-current text-[9.5px]"
								>
									{i + 1}
								</span>
								<span>{step.label}</span>
							</span>
						{/if}
					</li>
					{#if i < trimSteps.length - 1}
						<span aria-hidden="true" class="px-[1px] text-[12px] text-[#2c2924]/30">→</span>
					{/if}
				{/each}
			</ol>
		</div>
	</section>
{/if}
