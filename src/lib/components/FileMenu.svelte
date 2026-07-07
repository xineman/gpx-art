<script lang="ts">
	import { ArrowDownToLine, ArrowUpFromLine, MoreHorizontal } from '@lucide/svelte';
	import { neutralActionButton } from '$lib/constants/styles';
	import type { SketchState } from '$lib/sketch/state.svelte';

	type Props = {
		sketch: SketchState;
		class?: string;
	};
	let { sketch, class: extraClass = '' }: Props = $props();

	// The "⋯" overflow menu is the single entry point for the rarely-used
	// file actions. It opens a small absolutely-positioned dropdown above the
	// button (the bar sits at the bottom-left, so the menu grows up).
	let menuOpen = $state(false);
	let menuButton: HTMLButtonElement | undefined = $state();
	let menuElement: HTMLDivElement | undefined = $state();
	let fileInput: HTMLInputElement | undefined = $state();

	function closeMenu() {
		menuOpen = false;
	}

	function onExport() {
		sketch.exportDrawing();
		closeMenu();
	}

	function onImport() {
		closeMenu();
		fileInput?.click();
	}

	async function onFileChosen(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		// Reset the input so re-picking the same file still fires onchange.
		target.value = '';
		if (!file) {
			sketch.status = 'No file selected.';
			return;
		}
		await sketch.importDrawing(file);
	}

	// Close on outside click. mousedown (not click) fires before the click on
	// the underlying button, so the menu can't be reopened in the same gesture
	// that closed it. Skip if the click is inside the menu or the trigger.
	$effect(() => {
		if (!menuOpen) return;
		function onPointer(event: MouseEvent) {
			const target = event.target as Node | null;
			if (!target) return;
			if (menuElement?.contains(target)) return;
			if (menuButton?.contains(target)) return;
			closeMenu();
		}
		function onKey(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.stopPropagation();
				closeMenu();
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

	// Global file shortcuts. Always-on (not gated on menuOpen) so they work
	// whether the menu is visible or not. The Esc handler above prevents these
	// from firing when the menu intercepts a key, so there's no double-handling.
	$effect(() => {
		function onKeydown(event: KeyboardEvent) {
			const mod = event.metaKey || event.ctrlKey;
			if (!mod) return;
			const key = event.key.toLowerCase();
			if (key === 's') {
				event.preventDefault();
				sketch.exportDrawing();
			} else if (key === 'o') {
				event.preventDefault();
				fileInput?.click();
			}
		}
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

<div class="relative {extraClass}">
	<button
		bind:this={menuButton}
		aria-label="File actions"
		aria-haspopup="menu"
		aria-expanded={menuOpen}
		class={neutralActionButton}
		onclick={() => (menuOpen = !menuOpen)}
		title="File actions (Import / Export) — Cmd/Ctrl+S, Cmd/Ctrl+O"
		type="button"
	>
		<MoreHorizontal size={18} />
	</button>
	{#if menuOpen}
		<div
			bind:this={menuElement}
			role="menu"
			class="absolute bottom-[calc(100%+6px)] left-0 z-[600] flex min-w-[210px] flex-col gap-[2px] rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 p-2 shadow-[0_18px_50px_rgb(27_26_23_/_0.20)]"
		>
			<button
				role="menuitem"
				class="flex w-full cursor-pointer items-center gap-[8px] rounded-md px-[10px] py-[7px] text-left text-[13px] font-bold text-[#2c2924] transition-colors duration-150 hover:bg-[#e6b84a] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
				disabled={!sketch.hasDrawing && (!sketch.routedPath || sketch.routedPath.length === 0)}
				onclick={onExport}
				title="Export drawing (Cmd/Ctrl+S)"
				type="button"
			>
				<ArrowDownToLine size={16} />
				<span>Export drawing</span>
			</button>
			<label
				class="flex w-full cursor-pointer items-center gap-[8px] rounded-md py-[5px] pr-[10px] pl-[34px] text-[12px] text-[#2c2924]/70 transition-colors duration-150 hover:bg-[#e6b84a]/40 hover:text-[#2c2924]"
				title="Include matched route in the next export"
			>
				<input
					type="checkbox"
					bind:checked={sketch.includeRouteInExport}
					class="h-[13px] w-[13px] cursor-pointer accent-[#1e7d62]"
				/>
				<span>Include route</span>
			</label>
			<hr class="my-[3px] border-0 border-t border-[#2c2924]/10" />
			<button
				role="menuitem"
				class="flex w-full cursor-pointer items-center gap-[8px] rounded-md px-[10px] py-[7px] text-left text-[13px] font-bold text-[#2c2924] transition-colors duration-150 hover:bg-[#e6b84a]"
				onclick={onImport}
				title="Import drawing (Cmd/Ctrl+O)"
				type="button"
			>
				<ArrowUpFromLine size={16} />
				<span>Import drawing</span>
			</button>
		</div>
	{/if}
	<input
		bind:this={fileInput}
		type="file"
		accept="application/json,.json"
		class="hidden"
		onchange={onFileChosen}
		aria-hidden="true"
		tabindex="-1"
	/>
</div>
