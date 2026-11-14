import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	if (!import.meta.env.DEV) return error(404, 'Not found');

	const { default: script } = await import('redoc/bundles/redoc.standalone.js?url');
	return new Response(
		`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<title>GPX Art API Docs</title>
		<style>body { margin: 0; }</style>
	</head>
	<body>
		<div id="api-reference"></div>
		<noscript><a href="./openapi.json">View the OpenAPI spec as JSON</a></noscript>
		<script type="module">
			import { init } from '${script}';
			init('./openapi.json', { disableTelemetry: true }, document.getElementById('api-reference'));
		</script>
	</body>
</html>`,
		{ headers: { 'Content-Type': 'text/html; charset=utf-8' } }
	);
};
