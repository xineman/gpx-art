<script lang="ts">
	type Props = {
		error: string;
		class?: string;
	};
	let { error, class: extraClass = '' }: Props = $props();
</script>

{#if error}
	<p
		class="m-0 max-w-[min(420px,calc(100vw-36px))] rounded-lg border border-[#f26b3a] bg-[#fff7df] px-3 py-2.5 text-[13px] font-extrabold text-[#88380f] shadow-[0_14px_36px_rgb(27_26_23_/_0.18)] {extraClass}"
		role="status"
	>
		{error}
	</p>
{/if}
