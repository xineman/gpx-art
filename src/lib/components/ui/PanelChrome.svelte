<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Accessible name for the toolbar. */
		label: string;
		/** Horizontal = content-hugging row; vertical = compact rail. */
		orientation?: 'horizontal' | 'vertical';
		class?: string;
		children: Snippet;
	}

	let { label, orientation = 'horizontal', class: extraClass = '', children }: Props = $props();
</script>

<div
	class={[
		'inline-grid items-center gap-1 rounded-xl border border-panel-edge/20 bg-panel/95 p-2 shadow-panel backdrop-blur-sm',
		orientation === 'horizontal' && 'grid-flow-col auto-cols-max',
		extraClass
	]}
	aria-label={label}
	role="toolbar"
	aria-orientation={orientation}
>
	{@render children()}
</div>
