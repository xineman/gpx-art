<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>GPX Art</title>
	<meta
		name="description"
		content="Draw a shape on a map, convert it to a rideable GPX route, and export it."
	/>
</svelte:head>
{@render children()}
