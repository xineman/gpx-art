import { expect, test, type Page } from '@playwright/test';

// Google "Encoded Polyline Algorithm" encoder (precision=5) used to build
// the canned OSRM response below. Duplicates src/lib/routing/polyline.ts's
// decoder shape, inlined so the test fixture doesn't need to import the
// app's source.
function encodePolyline(points: { lat: number; lng: number }[]): string {
	const factor = 1e5;
	let prevLat = 0;
	let prevLng = 0;
	let out = '';
	const encode = (value: number) => {
		value = value < 0 ? ~(value << 1) : value << 1;
		while (value >= 0x20) {
			out += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
			value >>= 5;
		}
		out += String.fromCharCode(value + 63);
	};
	for (const { lat, lng } of points) {
		const dLat = Math.round(lat * factor) - prevLat;
		const dLng = Math.round(lng * factor) - prevLng;
		encode(dLat);
		encode(dLng);
		prevLat = Math.round(lat * factor);
		prevLng = Math.round(lng * factor);
	}
	return out;
}

// Ten points along a roughly east-west line near the default map centre
// (Warsaw at 52.23, 21.01). Stepping 0.001 deg between points gives the
// test a recognisable, evenly-spaced polyline to pick handles from.
const stubRoutePoints = [
	{ lat: 52.22, lng: 20.99 },
	{ lat: 52.221, lng: 21.0 },
	{ lat: 52.222, lng: 21.01 },
	{ lat: 52.223, lng: 21.02 },
	{ lat: 52.224, lng: 21.03 },
	{ lat: 52.225, lng: 21.04 },
	{ lat: 52.226, lng: 21.05 },
	{ lat: 52.227, lng: 21.06 },
	{ lat: 52.228, lng: 21.07 },
	{ lat: 52.229, lng: 21.08 }
];

async function stubOsrm(page: Page) {
	const fullGeometry = encodePolyline(stubRoutePoints);
	// A small 3-point bridge used when /route is called with just two
	// waypoints — that is the post-trim link between the two cut
	// endpoints. Distinct from the full polyline so the test can
	// distinguish the bridge call from any larger /route invocation.
	const bridgeGeometry = encodePolyline([
		{ lat: 52.222, lng: 21.01 },
		{ lat: 52.2225, lng: 21.015 },
		{ lat: 52.223, lng: 21.02 }
	]);

	// Match any URL containing the OSRM /route endpoint,
	// regardless of host (router.project-osrm.org on production, or
	// localhost:5050 on a developer's local osrm-routed setup).
	await page.route(/\/route\/v1\//, async (route) => {
		const url = route.request().url();
		// /route URL pattern: /route/v1/{profile}/{coords}?... where
		// coords is a ;-separated list of "lng,lat" pairs. A 2-waypoint
		// call is the trim bridge; anything else uses the full stub.
		const coordsMatch = url.match(/route\/v1\/[^/]+\/([^?]+)/);
		const coords = coordsMatch ? coordsMatch[1].split(';') : [];
		const geometry = coords.length === 2 ? bridgeGeometry : fullGeometry;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				code: 'Ok',
				routes: [{ geometry, distance: 200, duration: 50 }]
			})
		});
	});
}

// Drive the app into routed phase by injecting a known routedPath. This
// is faster and more reliable than drawing a shape + clicking Route, and
// it does not depend on map mouse coordinate math. The test hook
// __gpxArtTest.sketch is set up in +page.svelte.
async function seedRoutedPhase(page: Page, points: { lat: number; lng: number }[]) {
	await page.evaluate((pts) => {
		const w = window as unknown as {
			__gpxArtTest?: { sketch: { routedPath: { lat: number; lng: number }[]; phase: string } };
		};
		const sketch = w.__gpxArtTest?.sketch;
		if (!sketch) throw new Error('Test hook missing — is +page.svelte mounted?');
		sketch.routedPath = pts;
		sketch.phase = 'routed';
	}, points);
}

test.describe('route trimming', () => {
	test.beforeEach(async ({ page }) => {
		await stubOsrm(page);
		await page.goto('/');
		await page.waitForSelector('.maplibregl-canvas');
	});

	test('trim button appears in routed phase', async ({ page }) => {
		await seedRoutedPhase(page, stubRoutePoints);
		await expect(page.locator('button[aria-label="Trim route"]')).toBeVisible();
	});

	test('entering trim mode reveals cancel but not confirm', async ({ page }) => {
		await seedRoutedPhase(page, stubRoutePoints);
		await page.locator('button[aria-label="Trim route"]').click();
		await expect(page.locator('button[aria-label="Cancel trim"]')).toBeVisible();
		// Confirm only materialises once both picks are set — see the
		// "confirm trim button appears once both picks are set" test
		// below for the full flow.
		await expect(page.locator('button[aria-label="Confirm trim"]')).toHaveCount(0);
	});

	test('confirm trim button appears once both picks are set', async ({ page }) => {
		await seedRoutedPhase(page, stubRoutePoints);
		await page.locator('button[aria-label="Trim route"]').click();
		await expect(page.locator('button[aria-label="Confirm trim"]')).toHaveCount(0);

		// First pick only — still no confirm button.
		await page.evaluate(() => {
			const w = window as unknown as {
				__gpxArtTest?: { sketch: { trimStart: number | null; trimEnd: number | null } };
			};
			const sketch = w.__gpxArtTest?.sketch;
			if (!sketch) throw new Error('Test hook missing');
			sketch.trimStart = 2;
		});
		await expect(page.locator('button[aria-label="Confirm trim"]')).toHaveCount(0);

		// Second pick — confirm button materialises. The 180ms scale
		// transition means the button may not be queryable for one
		// frame; toBeVisible() retries until it appears.
		await page.evaluate(() => {
			const w = window as unknown as {
				__gpxArtTest?: { sketch: { trimEnd: number | null } };
			};
			const sketch = w.__gpxArtTest?.sketch;
			if (!sketch) throw new Error('Test hook missing');
			sketch.trimEnd = 6;
		});
		await expect(page.locator('button[aria-label="Confirm trim"]')).toBeVisible();
	});

	test('cancel restores the routed view without history changes', async ({ page }) => {
		await seedRoutedPhase(page, stubRoutePoints);
		await page.locator('button[aria-label="Trim route"]').click();
		await page.locator('button[aria-label="Cancel trim"]').click();

		await expect(page.locator('button[aria-label="Trim route"]')).toBeVisible();
		await expect(page.locator('button[aria-label="Cancel trim"]')).toHaveCount(0);

		const undoCount = await page.evaluate(() => {
			const w = window as unknown as { __gpxArtTest?: { sketch: { undoStack: unknown[] } } };
			return w.__gpxArtTest?.sketch.undoStack.length ?? 0;
		});
		expect(undoCount).toBe(0);
	});

	test('confirming a middle trim routes a bridge between the two cut endpoints', async ({
		page
	}) => {
		await seedRoutedPhase(page, stubRoutePoints);
		const initialLength = await page.evaluate(() => {
			const w = window as unknown as {
				__gpxArtTest?: { sketch: { routedPath: unknown[] | null } };
			};
			return w.__gpxArtTest?.sketch.routedPath?.length ?? 0;
		});
		expect(initialLength).toBe(stubRoutePoints.length);

		await page.locator('button[aria-label="Trim route"]').click();

		await page.evaluate(() => {
			const w = window as unknown as {
				__gpxArtTest?: {
					sketch: { trimMode: boolean; trimStart: number | null; trimEnd: number | null };
				};
			};
			const sketch = w.__gpxArtTest?.sketch;
			if (!sketch) throw new Error('Test hook missing');
			sketch.trimMode = true;
			sketch.trimStart = 2;
			sketch.trimEnd = 6;
		});

		await page.locator('button[aria-label="Confirm trim"]').click();

		// applyTrim is async: it splices the cut synchronously, then
		// awaits OSRM /route for the bridge. Wait for routeBusy to
		// clear before reading routedPath so we observe the post-bridge
		// state, not the optimistic straight-line intermediate.
		await page.waitForFunction(() => {
			const w = window as unknown as {
				__gpxArtTest?: { sketch: { routeBusy: boolean } };
			};
			return w.__gpxArtTest?.sketch.routeBusy === false;
		});

		const newLength = await page.evaluate(() => {
			const w = window as unknown as {
				__gpxArtTest?: { sketch: { routedPath: unknown[] | null } };
			};
			return w.__gpxArtTest?.sketch.routedPath?.length ?? 0;
		});
		// trimStart=2, trimEnd=6 removes 5 points. The bridge stub
		// returns a 3-point polyline between routedPath[1] (before) and
		// routedPath[7] (after); none of the bridge's decoded
		// coordinates coincide with `before` within 2 m so the dedup
		// skips nothing, and the bridge contributes all 3 points.
		// Final length = initialLength - 5 + 3.
		expect(newLength).toBe(initialLength - 2);
	});

	test('confirming a trim at the end of the route does not call OSRM', async ({ page }) => {
		await seedRoutedPhase(page, stubRoutePoints);

		// Count OSRM requests so we can assert the bridge call was skipped.
		let osrmCalls = 0;
		page.on('request', (req) => {
			if (/router\.project-osrm\.org/.test(req.url())) osrmCalls += 1;
		});

		await page.locator('button[aria-label="Trim route"]').click();
		await page.evaluate(() => {
			const w = window as unknown as {
				__gpxArtTest?: {
					sketch: { trimMode: boolean; trimStart: number | null; trimEnd: number | null };
				};
			};
			const sketch = w.__gpxArtTest?.sketch;
			if (!sketch) throw new Error('Test hook missing');
			sketch.trimMode = true;
			// Cut the last two points — no `after` endpoint, so no bridge.
			sketch.trimStart = 8;
			sketch.trimEnd = 9;
		});

		await page.locator('button[aria-label="Confirm trim"]').click();

		const newLength = await page.evaluate(() => {
			const w = window as unknown as {
				__gpxArtTest?: { sketch: { routedPath: unknown[] | null } };
			};
			return w.__gpxArtTest?.sketch.routedPath?.length ?? 0;
		});
		// No bridge, just a 2-point slice.
		expect(newLength).toBe(stubRoutePoints.length - 2);
		// No OSRM /route call expected. The stub serves any /route
		// request, so a counter > 0 means we did not skip the bridge.
		expect(osrmCalls).toBe(0);
	});

	test('action bar primary button is always the rightmost enabled button', async ({ page }) => {
		await seedRoutedPhase(page, stubRoutePoints);

		// In routed phase the action bar should end with the primary
		// green Export GPX button. Other buttons (Finish, Undo, Clear)
		// are still in the DOM but disabled; we filter to enabled
		// buttons to focus on what's actually clickable.
		const routedLast = await page.evaluate(() => {
			const bar = document.querySelector('section[aria-label="Route actions"]');
			if (!bar) throw new Error('action bar missing');
			const buttons = Array.from(
				bar.querySelectorAll<HTMLButtonElement>('button[aria-label]:not([disabled])')
			);
			const last = buttons.at(-1);
			return last?.getAttribute('aria-label') ?? null;
		});
		expect(routedLast).toBe('Export GPX');

		// Enter trim mode. Confirm/Cancel live in the TrimPanel now, so
		// the action bar should still end with the primary Export GPX.
		await page.locator('button[aria-label="Trim route"]').click();
		const trimLast = await page.evaluate(() => {
			const bar = document.querySelector('section[aria-label="Route actions"]');
			if (!bar) throw new Error('action bar missing');
			const buttons = Array.from(
				bar.querySelectorAll<HTMLButtonElement>('button[aria-label]:not([disabled])')
			);
			const last = buttons.at(-1);
			return last?.getAttribute('aria-label') ?? null;
		});
		expect(trimLast).toBe('Export GPX');

		// TrimPanel itself: Confirm is the primary action. With both
		// trim picks set, Confirm becomes enabled and is the rightmost
		// enabled button in the panel.
		await page.evaluate(() => {
			const w = window as unknown as {
				__gpxArtTest?: {
					sketch: { trimStart: number | null; trimEnd: number | null };
				};
			};
			const sketch = w.__gpxArtTest?.sketch;
			if (!sketch) throw new Error('Test hook missing');
			sketch.trimStart = 2;
			sketch.trimEnd = 6;
		});
		await expect(page.locator('button[aria-label="Confirm trim"]')).toBeEnabled();
		const trimPanelLast = await page.evaluate(() => {
			const panel = document.querySelector('section[aria-label="Trim instructions"]');
			if (!panel) throw new Error('trim panel missing');
			const buttons = Array.from(
				panel.querySelectorAll<HTMLButtonElement>('button[aria-label]:not([disabled])')
			);
			const last = buttons.at(-1);
			return last?.getAttribute('aria-label') ?? null;
		});
		expect(trimPanelLast).toBe('Confirm trim');
	});
});
