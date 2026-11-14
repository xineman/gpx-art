const FLASH_MS = 2200;

/**
 * Short-lived status-bar message any feature can raise.
 * The drawing status shows it on top of its live draft / tool baseline.
 */
class FlashState {
	#message = $state<string | null>(null);
	#timer: ReturnType<typeof setTimeout> | undefined;

	get message() {
		return this.#message;
	}

	/** Show `message` for `ms`; the baseline resumes when it expires. */
	show(message: string, ms = FLASH_MS) {
		clearTimeout(this.#timer);
		this.#message = message;
		this.#timer = setTimeout(() => {
			this.#message = null;
			this.#timer = undefined;
		}, ms);
	}

	clear() {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#message = null;
	}
}

export const flash = new FlashState();
