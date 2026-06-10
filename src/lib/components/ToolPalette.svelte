<script lang="ts">
	import { Hand, Pencil, Pentagon, Route, Square } from '@lucide/svelte';
	import { toolButtonBase } from '$lib/constants/styles';
	import type { Tool } from '$lib/types/sketch';
	import type { SketchState } from '$lib/sketch/state.svelte';

	type Props = {
		state: SketchState;
		class?: string;
	};
	let { state, class: extraClass = '' }: Props = $props();

	function toolButtonClass(tool: Tool) {
		return `${toolButtonBase} ${
			state.currentTool === tool ? 'bg-[#e6b84a] text-[#1f1d19]' : 'bg-transparent text-[#fff7df]'
		}`;
	}
</script>

<section
	class="grid items-center gap-[5px] rounded-lg border border-[#fff7df]/25 bg-[#2c2924] p-1.5 shadow-[0_18px_50px_rgb(27_26_23_/_0.28)] max-[620px]:w-full max-[620px]:grid-cols-5 {extraClass}"
	aria-label="Drawing tools"
>
	<button
		aria-label="Pan"
		class={toolButtonClass('pan')}
		disabled={state.phase !== 'editing'}
		onclick={() => state.setTool('pan')}
		title="Pan"
		type="button"
	>
		<Hand size={18} />
	</button>
	<button
		aria-label="Pencil"
		class={toolButtonClass('pencil')}
		disabled={state.phase !== 'editing'}
		onclick={() => state.setTool('pencil')}
		title="Pencil"
		type="button"
	>
		<Pencil size={18} />
	</button>
	<button
		aria-label="Line"
		class={toolButtonClass('line')}
		disabled={state.phase !== 'editing'}
		onclick={() => state.setTool('line')}
		title="Line"
		type="button"
	>
		<Route size={18} />
	</button>
	<button
		aria-label="Polygon"
		class={toolButtonClass('polygon')}
		disabled={state.phase !== 'editing'}
		onclick={() => state.setTool('polygon')}
		title="Polygon"
		type="button"
	>
		<Pentagon size={18} />
	</button>
	<button
		aria-label="Rectangle"
		class={toolButtonClass('rectangle')}
		disabled={state.phase !== 'editing'}
		onclick={() => state.setTool('rectangle')}
		title="Rectangle"
		type="button"
	>
		<Square size={18} />
	</button>
</section>
