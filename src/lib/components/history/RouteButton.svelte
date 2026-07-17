<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Navigation2 from '@lucide/svelte/icons/navigation-2';
	import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
	import RouteIcon from '@lucide/svelte/icons/route';
	import TooltipArrow from '$lib/components/ui/TooltipArrow.svelte';
	import { drawings } from '$lib/state/drawings.svelte';
	import { route } from '$lib/state/route.svelte';
	import { status } from '$lib/state/status.svelte';
	import { tools } from '$lib/state/tools.svelte';
	import { pointer } from '$lib/util/pointer.svelte';
	import { routeActionModel } from './route-action';

	const hasSketch = $derived(drawings.features.length > 0);
	const action = $derived(
		routeActionModel({
			status: route.status,
			loadingAction: route.loadingAction,
			hasSketch,
			markedWaypointCount: route.markedWaypointCount,
			canRefineRoute: route.canRefineRoute
		})
	);
	const showResetTip = $derived(
		pointer.ready && pointer.fineHover && route.hasRefinedRoute && !route.isLoading
	);

	function resultMessage(prefix: string): string {
		const detourLabel = route.detourCount
			? ` · ${route.detourCount} possible ${route.detourCount === 1 ? 'detour' : 'detours'}`
			: '';
		return `${prefix} · ${route.distanceLabel}${detourLabel}.`;
	}

	function handleFailure(error: string) {
		if (error === 'Superseded.') {
			status.clearFlash();
			return;
		}
		status.flash(error);
	}

	async function onPrimary() {
		const kind = action.kind;
		if (kind !== 'route' && kind !== 'refine') return;

		status.flash(kind === 'refine' ? 'Refining route…' : 'Routing…', 60_000);
		const result =
			kind === 'refine'
				? await route.refineRoute()
				: await route.generate(drawings.features, drawings.revision);
		if (!result.ok) {
			handleFailure(result.error);
			return;
		}

		tools.select('pan');
		status.flash(resultMessage(kind === 'refine' ? 'Route refined' : 'Route ready'));
	}

	async function onReset() {
		if (!route.hasRefinedRoute || route.isLoading) return;
		status.flash('Restoring sketch route…', 60_000);
		const result = await route.resetFromSketch(drawings.features, drawings.revision);
		if (!result.ok) {
			handleFailure(result.error);
			return;
		}

		tools.select('pan');
		status.flash(resultMessage('Sketch route restored'));
	}

	const baseSegment = [
		'relative inline-flex h-9.5 shrink-0 items-center gap-1.5 border-0 px-3',
		'font-mono text-[11px] font-semibold tracking-[0.12em] uppercase',
		'transition-[background,color,transform,box-shadow,opacity,filter] duration-150 ease-in-out'
	];
</script>

<div
	class="relative flex h-9.5 shrink-0 items-stretch"
	role={route.hasRefinedRoute ? 'group' : undefined}
	aria-label={route.hasRefinedRoute ? 'Route refinement' : undefined}
>
	{#if route.hasRefinedRoute}
		<div class="group/reset relative flex items-stretch">
			<button
				type="button"
				class={[
					'inline-flex h-9.5 w-9.5 items-center justify-center rounded-l-md border-0 border-r border-panel-edge/15 bg-panel-lift text-ink-muted',
					'transition-[background,color,opacity] duration-150 ease-in-out',
					'hover:bg-blaze hover:text-ink-dark',
					'focus-visible:z-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blaze/70 focus-visible:ring-offset-1 focus-visible:ring-offset-panel',
					route.isLoading ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'
				]}
				aria-label="Reset route from sketch"
				disabled={route.isLoading}
				onclick={onReset}
			>
				<RefreshCcw size={15} strokeWidth={2.2} />
			</button>

			{#if showResetTip}
				<span
					role="tooltip"
					class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-4 flex w-max -translate-x-1/2 -translate-y-0.75 scale-[0.96] flex-col items-center gap-0.5 rounded-md border border-panel-edge/15 bg-panel-lift px-2.5 pt-1.5 pb-2 text-center opacity-0 shadow-tooltip transition-all duration-150 ease-out group-hover/reset:translate-y-0 group-hover/reset:scale-100 group-hover/reset:opacity-100"
				>
					<span class="text-[10px] font-bold tracking-[0.14em] text-ink-bright uppercase">
						Reset route
					</span>
					<span class="font-mono text-[9px] font-medium tracking-normal text-ink-muted normal-case">
						Restore sketch waypoints
					</span>
					<TooltipArrow points="down" />
				</span>
			{/if}
		</div>
	{/if}

	{#if action.kind === 'route' || action.kind === 'refine' || action.kind === 'loading'}
		<button
			type="button"
			class={[
				baseSegment,
				route.hasRefinedRoute ? 'rounded-r-md' : 'rounded-md',
				'focus-visible:z-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-panel',
				action.kind === 'refine'
					? [
							'cursor-pointer bg-ember text-ink-dark shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--color-ink-dark)_35%,transparent)]',
							'hover:brightness-110 active:translate-y-px active:brightness-95 focus-visible:ring-ember/70'
						]
					: action.kind === 'route' && hasSketch
						? [
								'cursor-pointer bg-trail text-ink-dark shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--color-trail-deep)_55%,transparent)]',
								'hover:bg-trail-deep hover:text-trail-vertex hover:brightness-105',
								'active:translate-y-px active:brightness-95 focus-visible:ring-trail/70'
							]
						: action.kind === 'loading' && route.loadingAction === 'refine'
							? 'cursor-wait bg-ember text-ink-dark opacity-80 focus-visible:ring-ember/70'
							: action.kind === 'loading'
								? 'cursor-wait bg-trail text-ink-dark opacity-80 focus-visible:ring-trail/70'
								: 'cursor-not-allowed bg-panel-edge/8 text-ink-soft opacity-55 focus-visible:ring-trail/70'
			]}
			aria-label={action.ariaLabel}
			aria-busy={action.kind === 'loading'}
			disabled={action.kind === 'loading' || (action.kind === 'route' && !hasSketch)}
			onclick={onPrimary}
		>
			<span
				class={[
					'inline-flex size-4.5 items-center justify-center rounded-sm',
					action.kind === 'loading' || action.kind === 'refine' || hasSketch ? 'bg-ink-dark/12' : ''
				]}
				aria-hidden="true"
			>
				{#if action.kind === 'loading'}
					<LoaderCircle
						size={14}
						strokeWidth={2.4}
						class="animate-spin motion-reduce:animate-none"
					/>
				{:else if action.kind === 'refine'}
					<RouteIcon size={14} strokeWidth={2.35} />
				{:else}
					<Navigation2 size={14} strokeWidth={2.4} class={hasSketch ? '-rotate-12' : ''} />
				{/if}
			</span>
			<span>{action.label}</span>
		</button>
	{:else}
		<span
			class={[
				baseSegment,
				route.hasRefinedRoute ? 'rounded-r-md' : 'rounded-md',
				action.kind === 'keep' ? 'bg-ember/15 text-ember' : 'bg-blaze/15 text-blaze'
			]}
			aria-label={action.ariaLabel}
		>
			<span class="inline-flex size-4.5 items-center justify-center" aria-hidden="true">
				{#if action.kind === 'ready'}
					<CircleCheck size={15} strokeWidth={2.3} />
				{:else}
					<RouteIcon size={14} strokeWidth={2.3} />
				{/if}
			</span>
			<span>{action.label}</span>
		</span>
	{/if}
</div>
