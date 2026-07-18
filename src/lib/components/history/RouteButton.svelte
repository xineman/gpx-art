<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Navigation2 from '@lucide/svelte/icons/navigation-2';
	import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
	import RouteIcon from '@lucide/svelte/icons/route';
	import TooltipArrow from '$lib/components/ui/TooltipArrow.svelte';
	import { drawings } from '$lib/state/drawings.svelte';
	import { route } from '$lib/state/route.svelte';
	import { routingOptions } from '$lib/state/routing-options.svelte';
	import { status } from '$lib/state/status.svelte';
	import { tools } from '$lib/state/tools.svelte';
	import { dismissibleLayer } from '$lib/util/dismissible-layer';
	import { pointer } from '$lib/util/pointer.svelte';
	import { routeActionModel } from './route-action';

	const hasSketch = $derived(drawings.features.length > 0);
	const action = $derived(
		routeActionModel({
			status: route.status,
			loadingAction: route.loadingAction,
			hasSketch,
			moveWaypointCount: route.moveWaypointCount,
			removeWaypointCount: route.removeWaypointCount,
			canRefineRoute: route.canRefineRoute
		})
	);
	const showResetTip = $derived(
		pointer.ready && pointer.fineHover && route.hasRefinedRoute && !route.isLoading
	);
	const showReset = $derived(route.hasRefinedRoute && !route.isLoading);
	const showRouteOptions = $derived(
		!route.hasRefinedRoute &&
			(action.kind === 'route' || (action.kind === 'loading' && route.loadingAction === 'generate'))
	);
	const routeOptionsDisabled = $derived(route.isLoading || !hasSketch);
	let optionsOpen = $state(false);
	let optionsTrigger = $state<HTMLButtonElement | null>(null);

	function resultMessage(prefix: string): string {
		return `${prefix} · ${route.distanceLabel}.`;
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

		closeOptions();
		status.flash(kind === 'refine' ? 'Refining route…' : 'Routing…', 60_000);
		const result =
			kind === 'refine'
				? await route.refineRoute()
				: await route.generate(drawings.features, drawings.revision, {
						autoRefine: routingOptions.autoRefineOnGenerate
					});
		if (!result.ok) {
			handleFailure(result.error);
			return;
		}

		tools.select('pan');
		status.flash(resultMessage(kind === 'refine' ? 'Route refined' : 'Route ready'));
	}

	function toggleAutoRefine() {
		const next = !routingOptions.autoRefineOnGenerate;
		routingOptions.setAutoRefineOnGenerate(next);
		status.flash(`Automatic refinement ${next ? 'on' : 'off'}.`);
	}

	function closeOptions() {
		optionsOpen = false;
	}

	function toggleOptions() {
		optionsOpen = !optionsOpen;
	}

	$effect(() => {
		if (routeOptionsDisabled) closeOptions();
	});

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
	role={showReset ? 'group' : undefined}
	aria-label={showReset ? 'Route refinement' : undefined}
>
	{#if showReset}
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
				showRouteOptions ? 'rounded-l-md' : showReset ? 'rounded-r-md' : 'rounded-md',
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

		{#if showRouteOptions}
			<div class="relative flex">
				<button
					bind:this={optionsTrigger}
					type="button"
					class={[
						'inline-flex h-9.5 w-9.5 items-center justify-center rounded-r-md border-0 border-l',
						'transition-[background,color,opacity] duration-150 ease-in-out',
						route.isLoading
							? 'cursor-wait border-ink-dark/15 bg-trail text-ink-dark opacity-80'
							: !hasSketch
								? 'cursor-not-allowed border-panel-edge/8 bg-panel-edge/8 text-ink-soft opacity-55'
								: 'cursor-pointer border-ink-dark/15 bg-trail text-ink-dark hover:bg-trail-deep hover:text-trail-vertex focus-visible:z-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trail/70 focus-visible:ring-offset-1 focus-visible:ring-offset-panel'
					]}
					aria-label={hasSketch ? 'Route options' : 'Route options — sketch a shape first'}
					aria-expanded={optionsOpen}
					aria-haspopup="dialog"
					disabled={routeOptionsDisabled}
					onclick={toggleOptions}
				>
					<ChevronDown size={15} strokeWidth={2.4} />
				</button>

				{#if optionsOpen}
					<div
						use:dismissibleLayer={{ onDismiss: closeOptions, trigger: optionsTrigger }}
						role="dialog"
						aria-label="Route options"
						class="absolute bottom-full right-0 z-10 mb-4 w-56 rounded-md border border-panel-edge/15 bg-panel-lift p-1.5 shadow-tooltip"
					>
						<button
							type="button"
							role="switch"
							aria-checked={routingOptions.autoRefineOnGenerate}
							class="flex w-full cursor-pointer items-start gap-2.5 rounded-sm px-2.5 py-2 text-left text-ink-bright transition-colors hover:bg-panel-edge/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blaze/70"
							onclick={toggleAutoRefine}
						>
							<span
								class={[
									'mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors',
									routingOptions.autoRefineOnGenerate ? 'bg-trail' : 'bg-ink-soft'
								]}
								aria-hidden="true"
							>
								<span
									class={[
										'size-3 rounded-full bg-ink-dark transition-transform',
										routingOptions.autoRefineOnGenerate ? 'translate-x-3' : 'translate-x-0'
									]}
								></span>
							</span>
							<span class="flex min-w-0 flex-col gap-0.5">
								<span class="font-mono text-[10px] font-bold tracking-[0.12em] uppercase">
									Refine automatically
								</span>
								<span class="font-mono text-[9px] leading-3 text-ink-muted normal-case">
									Clean likely detours after routing
								</span>
							</span>
						</button>
					</div>
				{/if}
			</div>
		{/if}
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
