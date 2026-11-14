import { describe, expect, it } from 'vitest';
import { createLatestOperation } from './latest-operation';

describe('latest operation', () => {
	it('aborts and supersedes the previous operation when a new operation begins', async () => {
		const operations = createLatestOperation();
		let firstSignal!: AbortSignal;
		let resolveFirst!: (value: string) => void;
		const firstResult = operations.run(
			(operation) => {
				firstSignal = operation.signal;
				return operation.guard(
					new Promise<string>((resolve) => {
						resolveFirst = resolve;
					})
				);
			},
			() => 'superseded'
		);

		let secondSignal!: AbortSignal;
		const secondResult = operations.run(
			async (operation) => {
				secondSignal = operation.signal;
				return 'second';
			},
			() => 'superseded'
		);
		resolveFirst('first');

		expect(firstSignal.aborted).toBe(true);
		expect(secondSignal.aborted).toBe(false);
		await expect(firstResult).resolves.toBe('superseded');
		await expect(secondResult).resolves.toBe('second');
	});

	it('explicitly aborts and supersedes the current operation', async () => {
		const operations = createLatestOperation();
		let signal!: AbortSignal;
		let resolveOperation!: (value: string) => void;
		const result = operations.run(
			(operation) => {
				signal = operation.signal;
				return operation.guard(
					new Promise<string>((resolve) => {
						resolveOperation = resolve;
					})
				);
			},
			() => 'superseded'
		);

		operations.supersede();
		resolveOperation('completed');

		expect(signal.aborted).toBe(true);
		await expect(result).resolves.toBe('superseded');
	});

	it('does not hide errors from the current operation', async () => {
		const operations = createLatestOperation();
		const error = new Error('Failed.');

		await expect(
			operations.run(
				async (operation) => operation.guard(Promise.reject(error)),
				() => 'superseded'
			)
		).rejects.toBe(error);
	});
});
