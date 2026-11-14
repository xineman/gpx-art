import { dev } from '$app/env';
import { error } from '@sveltejs/kit';
import { buildOpenApiDocument } from '../openapi.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	if (!dev) error(404, 'Not found');

	return Response.json(buildOpenApiDocument());
};
