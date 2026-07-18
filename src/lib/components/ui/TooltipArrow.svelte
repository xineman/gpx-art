<script lang="ts">
	/**
	 * Dual-layer caret for panel tooltips.
	 * Outer ink rim keeps the tip legible on pale map tiles; inner blaze
	 * fill matches the accent underlines on the instrument chrome.
	 */
	interface Props {
		/** Direction the tip points (toward the trigger). */
		points: 'left' | 'down' | 'up';
		/** Horizontal anchor for vertical arrows. */
		align?: 'start' | 'center';
	}

	let { points, align = 'center' }: Props = $props();
</script>

{#if points === 'left'}
	<span
		aria-hidden="true"
		class="pointer-events-none absolute top-1/2 right-full -translate-y-1/2 drop-shadow-sm"
	>
		<span
			class="absolute top-1/2 right-0 -translate-y-1/2 border-y-[9px] border-r-[9px] border-y-transparent border-r-ink-dark"
		></span>
		<span
			class="absolute top-1/2 right-0 translate-x-px -translate-y-1/2 border-y-[5px] border-r-[5px] border-y-transparent border-r-blaze"
		></span>
	</span>
{:else if points === 'down'}
	<span
		aria-hidden="true"
		class={[
			'pointer-events-none absolute top-full drop-shadow-sm',
			align === 'start' ? 'left-10' : 'left-1/2 -translate-x-1/2'
		]}
	>
		<span
			class="absolute top-0 left-1/2 -translate-x-1/2 border-x-[9px] border-t-[9px] border-x-transparent border-t-ink-dark"
		></span>
		<span
			class="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-px border-x-[5px] border-t-[5px] border-x-transparent border-t-blaze"
		></span>
	</span>
{:else}
	<span
		aria-hidden="true"
		class={[
			'pointer-events-none absolute bottom-full drop-shadow-sm',
			align === 'start' ? 'left-10' : 'left-1/2 -translate-x-1/2'
		]}
	>
		<span
			class="absolute bottom-0 left-1/2 -translate-x-1/2 border-x-[9px] border-b-[9px] border-x-transparent border-b-ink-dark"
		></span>
		<span
			class="absolute bottom-0 left-1/2 translate-y-px -translate-x-1/2 border-x-[5px] border-b-[5px] border-x-transparent border-b-blaze"
		></span>
	</span>
{/if}
