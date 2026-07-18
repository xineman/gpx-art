<script lang="ts">
	import Files from '@lucide/svelte/icons/files';
	import FileDown from '@lucide/svelte/icons/file-down';
	import FileUp from '@lucide/svelte/icons/file-up';
	import {
		downloadTextFile,
		exportFilename,
		parseDrawingCollection,
		serializeDrawings
	} from '$lib/drawing/io';
	import TooltipArrow from '$lib/components/ui/TooltipArrow.svelte';
	import { drawings } from '$lib/state/drawings.svelte';
	import { status } from '$lib/state/status.svelte';
	import { dismissibleLayer } from '$lib/util/dismissible-layer';
	import { pointer } from '$lib/util/pointer.svelte';

	let open = $state(false);
	let triggerBtn = $state<HTMLButtonElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	const showHoverTip = $derived(pointer.ready && pointer.fineHover && !open);
	const canExport = $derived(drawings.features.length > 0);

	function close() {
		open = false;
	}

	function toggle() {
		open = !open;
	}

	function exportSketch() {
		if (!canExport) return;
		downloadTextFile(
			exportFilename(),
			serializeDrawings(drawings.collection),
			'application/geo+json'
		);
		status.flash('Sketch exported.');
		close();
	}

	function importSketch() {
		fileInput?.click();
	}

	async function onFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Allow re-selecting the same file later.
		input.value = '';
		if (!file) return;

		let text: string;
		try {
			text = await file.text();
		} catch {
			status.flash('Couldn’t read that file — try again.');
			close();
			return;
		}

		let raw: unknown;
		try {
			raw = JSON.parse(text) as unknown;
		} catch {
			status.flash('Couldn’t read that file — use a GeoJSON FeatureCollection.');
			close();
			return;
		}

		const parsed = parseDrawingCollection(raw);
		if (!parsed.ok) {
			status.flash(parsed.error);
			close();
			return;
		}

		drawings.replaceAll(parsed.features);
		status.flash(parsed.features.length === 0 ? 'Imported empty sketch.' : 'Sketch imported.');
		close();
	}
</script>

<div class="relative flex items-center justify-center">
	<div class="group/tooltip relative flex items-center justify-center">
		<button
			bind:this={triggerBtn}
			type="button"
			class={[
				'inline-flex size-9.5 shrink-0 items-center justify-center rounded-md border-0',
				'cursor-pointer transition-[background,color,transform,opacity] duration-150 ease-in-out',
				open
					? 'bg-blaze text-ink-dark'
					: 'bg-transparent text-ink-bright hover:bg-blaze hover:text-ink-dark'
			]}
			aria-label="Sketch file"
			aria-haspopup="menu"
			aria-expanded={open}
			onclick={toggle}
		>
			<Files size={18} strokeWidth={2.15} />
		</button>

		{#if showHoverTip}
			<span
				role="tooltip"
				class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-4 flex w-max -translate-x-1/2 -translate-y-0.75 scale-[0.96] flex-col items-center gap-0.5 rounded-md border border-panel-edge/15 bg-panel-lift px-2.5 pt-1.5 pb-2 text-center opacity-0 shadow-tooltip transition-all duration-150 ease-out group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100"
			>
				<span class="text-[10px] font-bold tracking-[0.14em] text-ink-bright uppercase">
					Sketch file
				</span>
				<TooltipArrow points="down" />
			</span>
		{/if}
	</div>

	{#if open}
		<div
			use:dismissibleLayer={{ onDismiss: close, trigger: triggerBtn }}
			role="menu"
			aria-label="Sketch file"
			class="absolute bottom-full left-1/2 z-20 mb-4 w-max min-w-36 -translate-x-1/2 rounded-md border border-panel-edge/15 bg-panel-lift p-1 shadow-tooltip"
		>
			<p class="px-2.5 pt-1.5 pb-1 text-[10px] font-medium text-ink-soft">Sketch file</p>

			<button
				type="button"
				role="menuitem"
				class={[
					'flex w-full items-center gap-2 rounded-sm border-0 px-2.5 py-1.75 text-left text-xs font-medium',
					'transition-[background,color,opacity] duration-150 ease-in-out',
					canExport
						? 'cursor-pointer bg-transparent text-ink-bright hover:bg-blaze hover:text-ink-dark focus-visible:bg-blaze focus-visible:text-ink-dark focus-visible:outline-none'
						: 'cursor-not-allowed text-ink-soft opacity-45'
				]}
				disabled={!canExport}
				onclick={exportSketch}
			>
				<FileDown size={15} strokeWidth={2.15} class="shrink-0 opacity-80" />
				Export
			</button>

			<button
				type="button"
				role="menuitem"
				class="flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2.5 py-1.75 text-left text-xs font-medium text-ink-bright transition-[background,color] duration-150 ease-in-out hover:bg-blaze hover:text-ink-dark focus-visible:bg-blaze focus-visible:text-ink-dark focus-visible:outline-none"
				onclick={importSketch}
			>
				<FileUp size={15} strokeWidth={2.15} class="shrink-0 opacity-80" />
				Import
			</button>
		</div>
	{/if}

	<input
		bind:this={fileInput}
		type="file"
		class="sr-only"
		accept=".geojson,.json,application/geo+json,application/json"
		tabindex={-1}
		aria-hidden="true"
		onchange={onFileChange}
	/>
</div>
