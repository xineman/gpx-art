import { test, expect } from '@playwright/test';

// Throwaway screenshot harness for the trim panel redesign. Captures
// the panel at each of the three states so the design can be reviewed
// without manually driving the app. Lives next to the e2e tests so it
// reuses the same preview-server + MapLibre bootstrap.

// A 10-point route stub. Coords are picked so that map-level state
// (centered on Warsaw at zoom 12) renders a recognisable polyline.
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

test.describe('trim panel screenshots', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('.maplibregl-canvas');
	});

	test('capture trim panel in each state', async ({ page }) => {
		await page.evaluate((pts) => {
			const sketch = (window as unknown as { __gpxArtTest?: { sketch: any } }).__gpxArtTest?.sketch;
			if (!sketch) throw new Error('Test hook missing');
			sketch.routedPath = pts;
			sketch.phase = 'routed';
		}, stubRoutePoints);

		await page.locator('button[aria-label="Trim route"]').click();
		await expect(page.locator('section[aria-label="Trim instructions"]')).toBeVisible();
		// Set a realistic hint for the "just entered" state — the
		// state setter would normally do this, but the test hook
		// bypasses it.
		await page.evaluate(() => {
			const sketch = (window as unknown as { __gpxArtTest?: { sketch: any } }).__gpxArtTest?.sketch;
			sketch.trimHint = 'Click the start of the stretch you want to remove.';
		});
		await page.waitForTimeout(250);

		const panel = page.locator('section[aria-label="Trim instructions"]');
		await panel.screenshot({ path: 'screenshots/trim-1-entered.png' });

		// Pick start only.
		await page.evaluate(() => {
			const sketch = (window as unknown as { __gpxArtTest?: { sketch: any } }).__gpxArtTest?.sketch;
			sketch.trimMode = true;
			sketch.trimStart = 2;
			sketch.trimEnd = null;
			sketch.trimHint = 'Now mark the end of the stretch to remove.';
		});
		await page.waitForTimeout(200);
		await panel.screenshot({ path: 'screenshots/trim-2-start-picked.png' });

		// Pick end too — Confirm materialises with a 180ms scale-in.
		await page.evaluate(() => {
			const sketch = (window as unknown as { __gpxArtTest?: { sketch: any } }).__gpxArtTest?.sketch;
			sketch.trimEnd = 6;
			sketch.trimHint = 'Confirm to drop the marked span, or cancel to start over.';
		});
		await expect(page.locator('button[aria-label="Confirm trim"]')).toBeVisible();
		await page.waitForTimeout(300);
		await panel.screenshot({ path: 'screenshots/trim-3-both-picked.png' });
	});
});
