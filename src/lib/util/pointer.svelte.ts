/**
 * Whether the device can reliably use hover tooltips
 * (`:hover` + fine pointer). Coarse/touch devices should use status-bar
 * hints instead.
 *
 * Defaults to `false` (touch-safe) so SSR / first paint never show
 * desktop tooltips or short desktop status copy on phones. Client
 * `matchMedia` (or `setFineHover`) flips it for real mice/trackpads.
 */
let fineHover = $state(false);
let listening = false;
/** True after client `matchMedia` (or a test override) has been applied. */
let ready = $state(false);
/** Test / DevTools override — null means follow matchMedia. */
let override: boolean | null = null;

function readMedia(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function apply() {
	fineHover = override ?? readMedia();
	ready = typeof window !== 'undefined';
}

function ensureInit() {
	if (typeof window === 'undefined' || listening) return;
	listening = true;
	apply();
	const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
	// Safari < 14 used addListener; modern browsers use addEventListener.
	if (typeof mq.addEventListener === 'function') {
		mq.addEventListener('change', () => apply());
	} else {
		mq.addListener(() => apply());
	}
}

export const pointer = {
	/** True after client init has run (SSR stays false). */
	get ready() {
		ensureInit();
		return ready;
	},
	/** True for mouse/trackpad-class devices; false for most phones/tablets. */
	get fineHover() {
		ensureInit();
		return fineHover;
	},
	/** Explicit init (e.g. from FullscreenMap mount). Safe to call repeatedly. */
	init() {
		ensureInit();
	},
	/**
	 * Force fine/coarse mode (tests). Pass `null` to follow the OS again.
	 * Also exposed on `window.__gpxArtPointer` in DEV for agent checks.
	 */
	setFineHover(value: boolean | null) {
		override = value;
		ensureInit();
		apply();
	}
};

// DEV-only browser hook for agent / manual checks.
if (import.meta.env.DEV && typeof window !== 'undefined') {
	(window as unknown as { __gpxArtPointer?: typeof pointer }).__gpxArtPointer = pointer;
}
