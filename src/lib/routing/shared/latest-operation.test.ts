import { describe, expect, it } from 'vitest';
import { createLatestOperation } from './latest-operation';

describe('latest operation', () => {
	it('aborts and invalidates the previous lease when a new operation begins', () => {
		const operations = createLatestOperation();
		const first = operations.begin();
		const second = operations.begin();

		expect(first.signal.aborted).toBe(true);
		expect(first.isCurrent()).toBe(false);
		expect(second.signal.aborted).toBe(false);
		expect(second.isCurrent()).toBe(true);
	});

	it('explicitly supersedes the current lease', () => {
		const operations = createLatestOperation();
		const operation = operations.begin();

		operations.supersede();

		expect(operation.signal.aborted).toBe(true);
		expect(operation.isCurrent()).toBe(false);
	});
});
