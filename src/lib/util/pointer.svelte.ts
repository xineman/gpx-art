/**
 * Whether the device can reliably use hover tooltips
 * (`:hover` + fine pointer). Coarse/touch devices should use status-bar
 * hints instead.
 *
 * Defaults to `false` (touch-safe) so SSR / first paint never show
 * desktop tooltips or short desktop status copy on phones. Client
 * `matchMedia` (or `setFineHover`) flips it for real mice/trackpads.
 */
class PointerState {
	#fineHover = $state(false);
	#listening = false;
	/** True after client matchMedia or a test override has been applied. */
	#ready = $state(false);
	/** null follows matchMedia; otherwise force the test / DevTools value. */
	#override: boolean | null = null;

	/** True after client init has run (SSR stays false). */
	get ready() {
		this.#ensureInit();
		return this.#ready;
	}

	/** True for mouse/trackpad-class devices; false for most phones/tablets. */
	get fineHover() {
		this.#ensureInit();
		return this.#fineHover;
	}

	/** Safe to call repeatedly, including from FullscreenMap mount. */
	init() {
		this.#ensureInit();
	}

	/** Force fine/coarse mode; pass null to follow the OS again. */
	setFineHover(value: boolean | null) {
		this.#override = value;
		this.#ensureInit();
		this.#apply();
	}

	#readMedia(): boolean {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	}

	#apply() {
		this.#fineHover = this.#override ?? this.#readMedia();
		this.#ready = typeof window !== 'undefined';
	}

	#ensureInit() {
		if (typeof window === 'undefined' || this.#listening) return;
		this.#listening = true;
		this.#apply();
		const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
		// Safari < 14 used addListener; modern browsers use addEventListener.
		if (typeof mq.addEventListener === 'function') {
			mq.addEventListener('change', () => this.#apply());
		} else {
			mq.addListener(() => this.#apply());
		}
	}
}

export const pointer = new PointerState();

// DEV-only browser hook for agent / manual checks.
if (import.meta.env.DEV && typeof window !== 'undefined') {
	(window as unknown as { __gpxArtPointer?: typeof pointer }).__gpxArtPointer = pointer;
}
