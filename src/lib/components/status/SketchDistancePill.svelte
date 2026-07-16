<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import TooltipArrow from '$lib/components/ui/TooltipArrow.svelte';
	import { pointer } from '$lib/util/pointer.svelte';

	interface Props {
		distanceLabel: string;
	}

	let { distanceLabel }: Props = $props();

	let rootEl = $state<HTMLDivElement | null>(null);
	let hovered = $state(false);
	let focused = $state(false);
	let touchOpen = $state(false);
	let dismissed = $state(false);

	const tooltipId = $props.id();
	const desktopVisible = $derived(
		pointer.ready && pointer.fineHover && !dismissed && (hovered || focused)
	);
	const visible = $derived(touchOpen || desktopVisible);

	function onPointerEnter() {
		if (!pointer.fineHover) return;
		hovered = true;
		dismissed = false;
	}

	function onPointerLeave() {
		if (!pointer.fineHover) return;
		hovered = false;
		if (!focused) dismissed = false;
	}

	function onFocus() {
		focused = true;
		dismissed = false;
	}

	function onBlur() {
		focused = false;
		if (!hovered) dismissed = false;
	}

	function onClick() {
		if (pointer.fineHover) return;
		touchOpen = !touchOpen;
	}

	function close() {
		touchOpen = false;
		dismissed = true;
	}

	function onDocumentPointerDown(event: PointerEvent) {
		if (!touchOpen || !rootEl) return;
		const target = event.target;
		if (target instanceof Node && rootEl.contains(target)) return;
		close();
	}

	function onDocumentKeyDown(event: KeyboardEvent) {
		if (!visible || event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		close();
	}

	$effect(() => {
		if (!visible) return;
		document.addEventListener('pointerdown', onDocumentPointerDown, true);
		document.addEventListener('keydown', onDocumentKeyDown, true);
		return () => {
			document.removeEventListener('pointerdown', onDocumentPointerDown, true);
			document.removeEventListener('keydown', onDocumentKeyDown, true);
		};
	});
</script>

<div class="relative -my-1.5 flex min-h-9.5 items-center" bind:this={rootEl}>
	<button
		type="button"
		class="inline-flex cursor-help items-center gap-1 rounded-full border-0 bg-panel px-2.25 py-1.75 text-xs leading-none font-bold text-ink-bright transition-[background,color,box-shadow] duration-150 ease-in-out hover:bg-panel-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trail-deep/65 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-bright"
		aria-label={`Sketch distance: ${distanceLabel}. More information`}
		aria-describedby={tooltipId}
		aria-expanded={visible}
		onpointerenter={onPointerEnter}
		onpointerleave={onPointerLeave}
		onfocus={onFocus}
		onblur={onBlur}
		onclick={onClick}
	>
		<span>Sketch · {distanceLabel}</span>
		<Info size={12} strokeWidth={2.4} aria-hidden="true" />
	</button>

	<span
		id={tooltipId}
		role="tooltip"
		class={[
			'pointer-events-none absolute top-full left-0 z-20 mt-2.5 w-64 max-w-[calc(100vw-48px)] rounded-md border border-panel-edge/15 bg-panel-lift px-3 py-2.5 text-left shadow-tooltip transition-[opacity,transform,visibility] duration-150 ease-out',
			visible
				? 'visible translate-y-0 scale-100 opacity-100'
				: 'invisible -translate-y-0.75 scale-[0.96] opacity-0'
		]}
	>
		<span class="block text-[10px] font-bold tracking-[0.12em] text-ink-bright uppercase">
			Sketch distance
		</span>
		<span class="mt-0.5 block text-[10px] leading-snug font-medium text-ink-muted">
			This measures your drawing. The route may differ because it follows bike roads.
		</span>
		<TooltipArrow points="up" align="start" />
	</span>
</div>
