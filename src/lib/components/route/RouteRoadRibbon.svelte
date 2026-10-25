<script lang="ts">
	import { onDestroy } from 'svelte';
	import { route } from '#lib/state/route.svelte.js';
	import type { RouteRoadKind, RouteRoadSpan } from '#lib/routing/attribution/types.js';

	let activeIndex = $state<number | null>(null);
	let pinnedIndex = $state<number | null>(null);

	const activeSpan = $derived(activeIndex === null ? null : (route.roadSpans[activeIndex] ?? null));

	const kindLabels: Record<RouteRoadKind, string> = {
		national: 'National road',
		voivodeship: 'Voivodeship road',
		county: 'County road',
		municipal: 'Municipal road',
		other: 'Local or unclassified road'
	};

	const kindClasses: Record<RouteRoadKind, string> = {
		national: 'bg-road-national text-ink-dark',
		voivodeship: 'bg-road-voivodeship text-ink-dark',
		county: 'bg-road-county text-ink-dark',
		municipal: 'bg-road-municipal text-ink-dark',
		other: 'bg-road-other text-ink-bright'
	};

	type BikeFacility = {
		kind: 'cycleway' | 'bike-lane';
		label: string;
	};

	function normalized(value: string | null) {
		return value?.trim().toLowerCase().replaceAll('-', '_') ?? null;
	}

	function humanize(value: string) {
		const words = value.replaceAll('_', ' ');
		return words.charAt(0).toUpperCase() + words.slice(1);
	}

	function bikeFacility(span: RouteRoadSpan): BikeFacility | null {
		if (normalized(span.use) === 'cycleway') return { kind: 'cycleway', label: 'Cycleway' };

		const cycleLane = normalized(span.cycleLane);
		if (!cycleLane || cycleLane === 'none' || cycleLane === 'no') return null;
		if (cycleLane === 'separated') return { kind: 'bike-lane', label: 'Separated bike lane' };
		if (cycleLane === 'shared') return { kind: 'bike-lane', label: 'Shared bike lane' };
		return { kind: 'bike-lane', label: 'Bike lane' };
	}

	function spanClass(span: RouteRoadSpan) {
		const facility = bikeFacility(span);
		if (facility?.kind === 'cycleway') return 'bg-trail text-ink-dark';
		if (facility?.kind === 'bike-lane') return 'bg-trail-deep text-ink-bright';
		return kindClasses[span.roadKind];
	}

	function spanKindLabel(span: RouteRoadSpan) {
		return bikeFacility(span)?.label ?? kindLabels[span.roadKind];
	}

	function spanDetailParts(span: RouteRoadSpan) {
		const facility = bikeFacility(span);
		const parts = [facility?.label ?? kindLabels[span.roadKind]];
		if (facility?.kind === 'cycleway') {
			const cycleLane = normalized(span.cycleLane);
			if (cycleLane && cycleLane !== 'none' && cycleLane !== 'no') parts.push(humanize(cycleLane));
		} else if (facility) {
			parts.push(kindLabels[span.roadKind]);
		} else if (span.roadClass) {
			parts.push(humanize(span.roadClass));
		}
		if (span.surface) parts.push(humanize(span.surface));
		return parts;
	}

	function formatKm(meters: number) {
		return (meters / 1000).toFixed(1);
	}

	function formatDistance(meters: number) {
		return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
	}

	function formatPosition(position: number[]) {
		return `${position[1]?.toFixed(5)}, ${position[0]?.toFixed(5)}`;
	}

	function roadLabel(span: RouteRoadSpan) {
		return span.ref ?? span.name ?? bikeFacility(span)?.label ?? span.displayLabel;
	}

	function ribbonLabel(span: RouteRoadSpan) {
		return span.ref ?? span.name ?? bikeFacility(span)?.label ?? '';
	}

	function accessibleDescription(span: RouteRoadSpan) {
		const label = roadLabel(span);
		const kind = spanKindLabel(span);
		return `${label === kind ? label : `${label}, ${kind}`}, ${formatDistance(span.distanceM)}, route kilometer ${formatKm(span.startM)} to ${formatKm(span.endM)}`;
	}

	function inspect(index: number | null) {
		activeIndex = index;
		route.inspectRoadSpan(index);
	}

	function hover(index: number, event: PointerEvent) {
		if (event.pointerType === 'mouse') inspect(index);
	}

	function leave(event: PointerEvent) {
		if (event.pointerType === 'mouse') inspect(pinnedIndex);
	}

	function toggle(index: number) {
		if (pinnedIndex === index) {
			pinnedIndex = null;
			inspect(null);
		} else {
			pinnedIndex = index;
			inspect(index);
		}
	}

	function moveFocus(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
		if (event.key === 'Escape') {
			pinnedIndex = null;
			inspect(null);
			return;
		}
		event.preventDefault();
		const toolbar = (event.currentTarget as HTMLElement).closest('[data-road-toolbar]');
		const buttons = Array.from(
			toolbar?.querySelectorAll<HTMLButtonElement>('[data-road-span]') ?? []
		);
		const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
		let next = current;
		if (event.key === 'Home') next = 0;
		if (event.key === 'End') next = buttons.length - 1;
		if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
		if (event.key === 'ArrowRight') next = Math.min(buttons.length - 1, current + 1);
		buttons[next]?.focus();
	}

	onDestroy(() => route.inspectRoadSpan(null));
</script>

{#if route.isReady && route.roadSpans.length > 0}
	<section class="relative w-full max-w-3xl" aria-label="Route roads">
		{#if activeSpan}
			<div
				class="absolute right-0 bottom-full left-0 mb-2 rounded-lg border border-panel-edge/15 bg-panel-lift/96 px-3 py-2.5 shadow-tooltip backdrop-blur-md"
				role="status"
				aria-live="polite"
			>
				<div class="flex min-w-0 items-start gap-2.5">
					<span
						class={`mt-0.5 shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold ${spanClass(activeSpan)}`}
					>
						{activeSpan.ref ?? (bikeFacility(activeSpan) ? 'BIKE' : '—')}
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
							<p class="truncate text-xs font-semibold text-ink-bright">
								{activeSpan.name ?? bikeFacility(activeSpan)?.label ?? activeSpan.displayLabel}
							</p>
							<p class="font-mono text-[10px] text-ink-muted">
								km {formatKm(activeSpan.startM)}–{formatKm(activeSpan.endM)} ·
								{formatDistance(activeSpan.distanceM)}
							</p>
						</div>
						<p class="mt-1 font-mono text-[9px] leading-relaxed text-ink-muted">
							{spanDetailParts(activeSpan).join(' · ')}
						</p>
						<p class="mt-0.5 truncate font-mono text-[9px] text-ink-soft">
							{formatPosition(activeSpan.start)} → {formatPosition(activeSpan.end)}
						</p>
					</div>
				</div>
			</div>
		{/if}

		<div
			data-road-toolbar
			role="group"
			aria-label="Route road segments"
			class="flex h-8 w-full overflow-hidden rounded-md border border-panel-edge/20 bg-panel-lift shadow-panel"
		>
			{#each route.roadSpans as span, index (`${span.startShapeIndex}-${span.endShapeIndex}-${index}`)}
				<button
					type="button"
					data-road-span
					class={[
						'road-segment relative min-w-px overflow-hidden outline-none',
						'focus-visible:z-1 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-panel-edge',
						spanClass(span),
						activeIndex === index
							? 'z-1 brightness-110 ring-2 ring-inset ring-panel-edge'
							: 'hover:brightness-110'
					]}
					style={`flex: ${Math.max(span.distanceM, 1)} 1 0`}
					aria-label={accessibleDescription(span)}
					aria-pressed={pinnedIndex === index}
					onpointerenter={(event) => hover(index, event)}
					onpointerleave={leave}
					onfocus={() => inspect(index)}
					onclick={() => toggle(index)}
					onkeydown={moveFocus}
				>
					<span
						class="road-label pointer-events-none absolute inset-0 items-center justify-center truncate px-1 font-mono text-[9px] font-semibold"
					>
						{ribbonLabel(span)}
					</span>
				</button>
			{/each}
		</div>
		<p class="mt-1.5 text-center font-mono text-[9px] tracking-[0.12em] text-ink-muted uppercase">
			Roads · {route.distanceLabel}
		</p>
	</section>
{/if}

<style>
	.road-segment {
		container-type: inline-size;
	}

	.road-label {
		display: none;
	}

	@container (min-width: 2.75rem) {
		.road-label {
			display: flex;
		}
	}
</style>
