type LatestOperationLease = {
	readonly signal: AbortSignal;
	isCurrent(): boolean;
};

export type LatestOperationScope = {
	readonly signal: AbortSignal;
	/**
	 * Guard awaited work and stop the surrounding operation if its lease was superseded
	 * before the promise settled.
	 */
	guard<T>(promise: Promise<T>): Promise<T>;
};

export type LatestOperation = {
	run<T, S>(
		work: (operation: LatestOperationScope) => Promise<T>,
		onSuperseded: () => S
	): Promise<T | S>;
	supersede(): void;
};

const supersededOperation = Symbol('superseded operation');

/**
 * Coordinate latest-command-wins async work.
 *
 * Starting or explicitly superseding an operation aborts the previous signal.
 * The lease check remains necessary for work that does not observe AbortSignal.
 */
export function createLatestOperation(): LatestOperation {
	let current: AbortController | null = null;

	function begin(): LatestOperationLease {
		current?.abort();
		const controller = new AbortController();
		current = controller;

		return {
			signal: controller.signal,
			isCurrent: () => current === controller && !controller.signal.aborted
		};
	}

	return {
		async run(work, onSuperseded) {
			const lease = begin();
			const operation: LatestOperationScope = {
				signal: lease.signal,
				async guard(promise) {
					const outcome = await promise.then(
						(value) => ({ ok: true as const, value }),
						(error: unknown) => ({ ok: false as const, error })
					);
					if (!lease.isCurrent()) throw supersededOperation;
					if (!outcome.ok) throw outcome.error;
					return outcome.value;
				}
			};

			try {
				return await work(operation);
			} catch (error) {
				if (error === supersededOperation) return onSuperseded();
				throw error;
			}
		},
		supersede() {
			current?.abort();
			current = null;
		}
	};
}
