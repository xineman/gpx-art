<script lang="ts">
	import Navigation2 from '@lucide/svelte/icons/navigation-2';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { drawings } from '$lib/state/drawings.svelte';
	import { route } from '$lib/state/route.svelte';
	import { status } from '$lib/state/status.svelte';

	/**
	 * Primary cartridge action: convert the sketch into a rideable bike route
	 * via OSRM Route (server-proxied).
	 */
	const canRoute = $derived(drawings.features.length > 0 && !route.isLoading);

	async function onRoute() {
		if (!canRoute) return;
		status.flash('Routing…', 60_000);
		const result = await route.generate(drawings.features);
		if (!result.ok) {
			if (result.error === 'Superseded.') {
				status.clearFlash();
				return;
			}
			status.flash(result.error);
			return;
		}
		status.flash(`Route ready · ${route.distanceLabel}.`);
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
	aria-label={route.isLoading ? 'Routing…' : canRoute ? 'Route' : 'Route — sketch a shape first'}
	aria-busy={route.isLoading}
	disabled={!canRoute}
	onclick={onRoute}
>
	<span
		class={[
			'inline-flex size-4.5 items-center justify-center rounded-sm',
			canRoute || route.isLoading ? 'bg-ink-dark/12' : ''
		]}
		aria-hidden="true"
	>
		{#if route.isLoading}
			<LoaderCircle size={14} strokeWidth={2.4} class="animate-spin" />
		{:else}
			<Navigation2 size={14} strokeWidth={2.4} class={canRoute ? '-rotate-12' : ''} />
		{/if}
	</span>
	<span>{route.isLoading ? 'Routing' : 'Route'}</span>
</button>
