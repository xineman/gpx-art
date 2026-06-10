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

{#snippet tooltip(text: string)}
	<span
		role="tooltip"
		class="pointer-events-none absolute top-1/2 left-full z-10 ml-2 -translate-x-[-3px] -translate-y-1/2 scale-[0.96] rounded-md border border-[#fff7df]/15 bg-[#1f1d19] px-3 py-1.5 text-[10px] font-bold tracking-[0.14em] whitespace-nowrap text-[#fff7df] uppercase opacity-0 shadow-[0_18px_40px_-8px_rgb(27_26_23_/_0.55)] transition-all duration-150 ease-out group-hover/tooltip:translate-x-0 group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100 max-[620px]:top-auto max-[620px]:bottom-full max-[620px]:left-1/2 max-[620px]:mb-2 max-[620px]:ml-0 max-[620px]:-translate-x-1/2 max-[620px]:translate-y-[-3px] max-[620px]:group-hover/tooltip:translate-y-0"
	>
		{text}
		<span
			aria-hidden="true"
			class="absolute inset-x-2 bottom-1 h-[1.5px] rounded-full bg-[#e6b84a] max-[620px]:hidden"
		></span>
		<span
			aria-hidden="true"
			class="absolute top-1/2 right-full -translate-y-1/2 border-y-4 border-r-[5px] border-y-transparent border-r-[#e6b84a] max-[620px]:top-full max-[620px]:right-auto max-[620px]:left-1/2 max-[620px]:-translate-x-1/2 max-[620px]:translate-y-0 max-[620px]:border-x-4 max-[620px]:border-y-0 max-[620px]:border-t-4 max-[620px]:border-r-0 max-[620px]:border-x-transparent max-[620px]:border-t-[#e6b84a]"
		></span>
	</span>
{/snippet}

<section
	class="grid items-center gap-[5px] rounded-lg border border-[#fff7df]/25 bg-[#2c2924] p-1.5 shadow-[0_18px_50px_rgb(27_26_23_/_0.28)] max-[620px]:w-full max-[620px]:grid-cols-5 {extraClass}"
	aria-label="Drawing tools"
>
	<div class="group/tooltip relative">
		<button
			aria-label="Pan"
			class={toolButtonClass('pan')}
			disabled={state.phase !== 'editing'}
			onclick={() => state.setTool('pan')}
			type="button"
		>
			<Hand size={18} />
		</button>
		{@render tooltip('Pan (hold Space)')}
	</div>
	<div class="group/tooltip relative">
		<button
			aria-label="Pencil"
			class={toolButtonClass('pencil')}
			disabled={state.phase !== 'editing'}
			onclick={() => state.setTool('pencil')}
			type="button"
		>
			<Pencil size={18} />
		</button>
		{@render tooltip('Pencil')}
	</div>
	<div class="group/tooltip relative">
		<button
			aria-label="Line"
			class={toolButtonClass('line')}
			disabled={state.phase !== 'editing'}
			onclick={() => state.setTool('line')}
			type="button"
		>
			<Route size={18} />
		</button>
		{@render tooltip('Line')}
	</div>
	<div class="group/tooltip relative">
		<button
			aria-label="Polygon"
			class={toolButtonClass('polygon')}
			disabled={state.phase !== 'editing'}
			onclick={() => state.setTool('polygon')}
			type="button"
		>
			<Pentagon size={18} />
		</button>
		{@render tooltip('Polygon')}
	</div>
	<div class="group/tooltip relative">
		<button
			aria-label="Rectangle"
			class={toolButtonClass('rectangle')}
			disabled={state.phase !== 'editing'}
			onclick={() => state.setTool('rectangle')}
			type="button"
		>
			<Square size={18} />
		</button>
		{@render tooltip('Rectangle')}
	</div>
</section>
