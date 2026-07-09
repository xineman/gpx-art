<script lang="ts">
	import { RotateCcw, Undo2 } from '@lucide/svelte';
	import { neutralActionButton } from '$lib/constants/styles';
	import FileMenu from './FileMenu.svelte';
	import RouteSettingsPanel from './RouteSettingsPanel.svelte';
	import type { SketchState } from '$lib/sketch/state.svelte';

	type Props = {
		sketch: SketchState;
		class?: string;
	};
	let { sketch, class: extraClass = '' }: Props = $props();

	// Only one dock popover at a time — File / Settings.
	type DockMenu = 'file' | 'settings' | null;
	let openMenu = $state<DockMenu>(null);

	function setMenu(id: Exclude<DockMenu, null>, open: boolean) {
		openMenu = open ? id : openMenu === id ? null : openMenu;
	}
</script>

<!--
	HistoryDock — the always-on utility strip. Lives above the StageActions
	pill and never changes shape, content, or position across phases. Its
	contents (Undo, Redo, File, Settings) are phase-orthogonal: history and
	secondary tooling apply regardless of what the user is doing now.
	Keeping it stable gives users a fixed visual anchor while the stage
	pill below it morphs.

	Settings opens as an upward popover (follow-sketch, corners, waypoints)
	so the map stays clear until the user asks for it.
-->
<section
	class="flex max-w-[calc(100vw-36px)] flex-wrap items-center gap-[7px] rounded-lg border border-[#2c2924]/15 bg-[#fff7df]/95 p-2 shadow-[0_18px_50px_rgb(27_26_23_/_0.20)] max-[620px]:w-full {extraClass}"
	aria-label="History and file actions"
>
	<button
		aria-label="Undo"
		class={neutralActionButton}
		disabled={sketch.phase === 'routing' || sketch.undoStack.length === 0}
		onclick={() => sketch.undo()}
		title="Undo (Cmd/Ctrl+Z)"
		type="button"
	>
		<Undo2 size={18} />
		<span>Undo</span>
	</button>
	<button
		aria-label="Redo"
		class={neutralActionButton}
		disabled={sketch.phase === 'routing' || sketch.redoStack.length === 0}
		onclick={() => sketch.redo()}
		title="Redo (Cmd/Ctrl+Shift+Z)"
		type="button"
	>
		<RotateCcw size={18} style="transform: scaleX(-1);" />
		<span>Redo</span>
	</button>
	<FileMenu {sketch} open={openMenu === 'file'} onOpenChange={(open) => setMenu('file', open)} />
	<RouteSettingsPanel
		{sketch}
		open={openMenu === 'settings'}
		onOpenChange={(open) => setMenu('settings', open)}
	/>
</section>
