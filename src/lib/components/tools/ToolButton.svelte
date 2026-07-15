<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ToolId } from '$lib/state/tools.svelte';
	import { tools } from '$lib/state/tools.svelte';

	interface Props {
		id: ToolId;
		label: string;
		hint: string;
		shortcut?: string;
		children: Snippet;
	}

	let { id, label, hint, shortcut, children }: Props = $props();

	const selected = $derived(tools.active === id && !tools.spaceHeld);
	const live = $derived(tools.effective === id);

	function activate() {
		tools.select(id);
	}
</script>

<button
	type="button"
	class={[
		'flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-[0.65rem] border-0 bg-transparent px-1.5 pt-2.5 pb-2',
		'font-mono text-ink-muted transition-[background,color,box-shadow] duration-150 ease-out',
		'motion-reduce:transition-none',
		'hover:bg-panel-lift/80 hover:text-ink-bright',
		'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blaze',
		selected && 'bg-blaze/15 text-ink-bright ring-1 ring-blaze/55 ring-inset',
		live && !selected && 'bg-trail/15 text-ink-bright ring-1 ring-trail/70 ring-inset'
	]}
	aria-label={label}
	aria-pressed={selected}
	title={shortcut ? `${label} (${shortcut}) — ${hint}` : `${label} — ${hint}`}
	onclick={activate}
>
	<span class="grid size-[1.35rem] place-items-center [&_svg]:size-[1.2rem] [&_svg]:stroke-[1.75]">
		{@render children()}
	</span>
	<span class="text-[0.58rem] leading-none font-medium tracking-[0.08em] uppercase">
		{label}
	</span>
</button>
