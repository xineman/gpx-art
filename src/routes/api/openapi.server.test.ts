import { expect, it } from 'vitest';
import { MAX_VIAS, MIN_VIAS } from '#lib/config/routing.js';
import { readBody as readAttributesBody } from './attributes/contract.server';
import { readBody as readMatrixBody } from './matrix/contract.server';
import { readBody as readRouteBody } from './route/contract.server';
import { buildOpenApiDocument } from './openapi.server';
import { jsonPostRequest } from './request.test-helper';

function jsonRequestBody(path: string) {
	const body = buildOpenApiDocument().paths?.[path]?.post?.requestBody;
	const media = body && 'content' in body ? body.content['application/json'] : undefined;
	if (!media || '$ref' in media) throw new Error(`Missing inline JSON request body for ${path}`);
	return media;
}

it('discovers the routing contracts as OpenAPI POST operations', () => {
	const { paths } = buildOpenApiDocument();
	expect(paths).toMatchObject({
		'/api/attributes': { post: { operationId: 'getRouteAttributes' } },
		'/api/matrix': { post: { operationId: 'getBicycleDistanceMatrix' } },
		'/api/route': { post: { operationId: 'matchBicycleRoute' } }
	});
	expect(paths).not.toHaveProperty('/api/docs');
	expect(paths).not.toHaveProperty('/api/openapi.json');
});

it('documents attribution as a nested LineString request with numeric positions', async () => {
	const { schema, example } = jsonRequestBody('/api/attributes');
	expect(await readAttributesBody(jsonPostRequest(example))).toEqual({ ok: true, data: example });
	expect(schema).toMatchObject({
		required: ['geometry'],
		properties: {
			geometry: {
				required: ['type', 'coordinates'],
				properties: {
					type: { const: 'LineString' },
					coordinates: { minItems: 2, items: { minItems: 2, items: { type: 'number' } } }
				}
			}
		}
	});
});

it('documents the route input before waypoints are normalized and deduplicated', async () => {
	const { schema, example } = jsonRequestBody('/api/route');
	expect(await readRouteBody(jsonPostRequest(example))).toEqual({ ok: true, data: example });
	expect(schema).toMatchObject({
		required: ['vias'],
		properties: {
			vias: {
				minItems: 2,
				items: {
					required: ['location'],
					properties: {
						location: { minItems: 2 },
						bearing: { type: 'integer', minimum: 0, maximum: 360 },
						bearingRange: { type: 'integer', minimum: 0, maximum: 180 }
					}
				}
			}
		}
	});
});

it('documents the input coordinates before the parser strips extra elements', async () => {
	const { example, schema } = jsonRequestBody('/api/matrix');
	expect(await readMatrixBody(jsonPostRequest(example))).toEqual({ ok: true, data: example });
	expect(schema).toMatchObject({
		required: ['coordinates'],
		properties: {
			coordinates: {
				minItems: MIN_VIAS,
				maxItems: MAX_VIAS,
				items: {
					minItems: 2,
					prefixItems: [
						{ minimum: -180, maximum: 180 },
						{ minimum: -90, maximum: 90 }
					]
				}
			}
		}
	});
	expect(schema).toHaveProperty('properties.coordinates.items.items', {});
});
