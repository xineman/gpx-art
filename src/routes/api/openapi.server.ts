import { createDocument, type ZodOpenApiOperationObject } from 'zod-openapi';

const operations = import.meta.glob<ZodOpenApiOperationObject>('./*/contract.server.ts', {
	eager: true,
	import: 'openApiPost'
});

export function buildOpenApiDocument() {
	return createDocument({
		openapi: '3.1.0',
		info: {
			title: 'GPX Art routing API',
			version: '0.0.1',
			description: 'Plan a bicycle route from a sketch and inspect the roads it follows.'
		},
		paths: Object.fromEntries(
			Object.entries(operations).map(([file, post]) => {
				const directory = file.slice('./'.length, -'/contract.server.ts'.length);
				return [`/api/${directory}`, { post }];
			})
		)
	});
}
