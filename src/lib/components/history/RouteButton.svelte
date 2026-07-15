<script lang="ts">
	import Navigation2 from '@lucide/svelte/icons/navigation-2';
	import { drawings } from '$lib/state/drawings.svelte';
	import { status } from '$lib/state/status.svelte';

	/**
	 * Primary cartridge action: convert the sketch into a rideable route.
	 * Routing is not wired yet — the button is real chrome with honest feedback.
	 */
	const canRoute = $derived(drawings.features.length > 0);

	function onRoute() {
		if (!canRoute) return;
		// Placeholder until OSRM / route generation lands.
		status.flash('Routing isn’t ready yet.');
	}
</script>

<button
	type="button"
	class={[
		// Taller match to icon tiles (size-9.5), but a labeled pill — the only
		// word-marked control in the cartridge so it reads as the next step.
		'relative inline-flex h-9.5 shrink-0 items-center gap-1.5 rounded-md border-0 px-3',
		'font-mono text-[11px] font-semibold tracking-[0.12em] uppercase',
		'transition-[background,color,transform,box-shadow,opacity,filter] duration-150 ease-in-out',
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trail/70 focus-visible:ring-offset-1 focus-visible:ring-offset-panel',
		canRoute
			? [
					'cursor-pointer bg-trail text-ink-dark shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--color-trail-deep)_55%,transparent)]',
					'hover:bg-trail-deep hover:text-trail-vertex hover:brightness-105',
					'active:translate-y-px active:brightness-95'
				]
			: 'cursor-not-allowed bg-panel-edge/8 text-ink-soft opacity-55'
	]}
	aria-label={canRoute ? 'Route' : 'Route — sketch a shape first'}
	disabled={!canRoute}
	onclick={onRoute}
>
	<!--
	  Compass arrow + word mark. Trail fill ties the CTA to map path paint;
	  the inset edge reads like a physical field instrument, not a flat chip.
	-->
	<span
		class={[
			// Inherit button color so hover transitions with the label
			// (own text-* + group-hover snaps instantly — no transition here).
			'inline-flex size-4.5 items-center justify-center rounded-sm',
			canRoute ? 'bg-ink-dark/12' : ''
		]}
		aria-hidden="true"
	>
		<Navigation2 size={14} strokeWidth={2.4} class={canRoute ? '-rotate-12' : ''} />
	</span>
	<span>Route</span>
</button>
