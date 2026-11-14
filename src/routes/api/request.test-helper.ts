export function jsonPostRequest(body: unknown) {
	return new Request('http://localhost', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}
