<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import Route from '@lucide/svelte/icons/route';
	import Pentagon from '@lucide/svelte/icons/pentagon';
	import Square from '@lucide/svelte/icons/square';
	import Hand from '@lucide/svelte/icons/hand';
	import PanelChrome from '$lib/components/ui/PanelChrome.svelte';
	import { TOOLS, type ToolId } from '$lib/state/tools.svelte';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		/** Parent shell owns placement; panel only paints the toolbar chrome. */
		layout?: 'desktop' | 'mobile';
	}

	let { layout = 'desktop' }: Props = $props();

	const icons: Record<ToolId, typeof Pencil> = {
		pencil: Pencil,
		polyline: Route,
		polygon: Pentagon,
		rectangle: Square,
		pan: Hand
	};
</script>

{#snippet toolButtons(size: 'sm' | 'md', tip: 'right' | 'above')}
	{#each TOOLS as tool (tool.id)}
		{@const Icon = icons[tool.id]}
		<ToolButton
			id={tool.id}
			label={tool.label}
			hint={tool.hint}
			shortcut={tool.shortcut}
			{size}
			{tip}
		>
			<Icon size={size === 'md' ? 19 : 18} strokeWidth={size === 'md' ? 2.15 : 2} />
		</ToolButton>
	{/each}
{/snippet}

{#if layout === 'desktop'}
	<!-- Compact vertical cartridge — even inset matches button radius rhythm. -->
	<PanelChrome label="Drawing tools" orientation="vertical">
		{@render toolButtons('sm', 'right')}
	</PanelChrome>
{:else}
	<!--
	  Field dock: hug the five tools instead of stretching edge-to-edge.
	  Equal padding on all sides so the bar reads as one instrument, not a
	  full-width tray with icons lost in empty cells.
	-->
	<PanelChrome label="Drawing tools">
		{@render toolButtons('md', 'above')}
	</PanelChrome>
{/if}
