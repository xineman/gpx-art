export type LatestOperationLease = {
	readonly signal: AbortSignal;
	isCurrent(): boolean;
};

export type LatestOperation = {
	begin(): LatestOperationLease;
	supersede(): void;
};

/**
 * Coordinate latest-command-wins async work.
 *
 * Starting or explicitly superseding an operation aborts the previous signal.
 * The lease check remains necessary for work that does not observe AbortSignal.
 */
export function createLatestOperation(): LatestOperation {
	let current: AbortController | null = null;

	return {
		begin() {
			current?.abort();
			const controller = new AbortController();
			current = controller;

			return {
				signal: controller.signal,
				isCurrent: () => current === controller && !controller.signal.aborted
			};
		},
		supersede() {
			current?.abort();
			current = null;
		}
	};
}
