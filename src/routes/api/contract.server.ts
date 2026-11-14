import type { z } from 'zod';
import type { ZodOpenApiOperationObject } from 'zod-openapi';
import { apiFailureSchema, type ApiFailure } from '#lib/routing/api/contracts.js';

export const apiStatus = {
	ok: 200,
	badRequest: 400,
	rateLimited: 429,
	badGateway: 502
} as const;

/**
 * HTTP status for a routing-provider failure. Failures without a provider status come from local
 * validation of the request or the provider's answer.
 */
export function providerFailureStatus(failure: ApiFailure) {
	if (failure.status === 429) return apiStatus.rateLimited;
	if (failure.status == null || failure.status === 400) return apiStatus.badRequest;
	return apiStatus.badGateway;
}

/** The provider failure responses every routing endpoint can return. */
export function providerFailureResponses(descriptions: { badRequest: string; badGateway: string }) {
	return {
		[apiStatus.badRequest]: failureResponse(descriptions.badRequest),
		[apiStatus.rateLimited]: failureResponse('The routing provider rate limited the request.'),
		[apiStatus.badGateway]: failureResponse(descriptions.badGateway)
	};
}

export function jsonRequest<S extends z.ZodType>(
	schema: S,
	example: z.input<S>,
	issueMessage: (issue: z.core.$ZodIssue | undefined) => string
) {
	return {
		issueMessage,
		requestBody: {
			required: true,
			content: { 'application/json': { schema, example } }
		}
	};
}

export function jsonResponse<S extends z.ZodType>(
	description: string,
	schema: S,
	example?: z.output<S>
) {
	return { description, content: { 'application/json': { schema, example } } };
}

export function failureResponse(description: string) {
	return jsonResponse(description, apiFailureSchema);
}

type JsonResponses = Record<number, ReturnType<typeof jsonResponse>> & {
	[apiStatus.badRequest]: ReturnType<typeof jsonResponse<z.ZodType<{ ok: false; error: string }>>>;
};

export function defineJsonPost<S extends z.ZodType, R extends JsonResponses>({
	operationId,
	summary,
	description,
	request: { requestBody, issueMessage },
	responses
}: {
	operationId: string;
	summary: string;
	description: string;
	request: ReturnType<typeof jsonRequest<S>>;
	responses: R;
}) {
	const schema = requestBody.content['application/json'].schema;

	async function readBody(request: Request) {
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return { ok: false as const, error: 'Request body must be JSON.' };
		}
		const parsed = schema.safeParse(body);
		if (!parsed.success) {
			return { ok: false as const, error: issueMessage(parsed.error.issues[0]) };
		}
		return { ok: true as const, data: parsed.data };
	}

	function json<Status extends keyof R & number>(
		status: Status,
		body: z.output<R[NoInfer<Status>]['content']['application/json']['schema']>
	) {
		return Response.json(body, { status });
	}

	return {
		readBody,
		json,
		openApiPost: {
			operationId,
			summary,
			description,
			requestBody,
			responses
		} satisfies ZodOpenApiOperationObject
	};
}
