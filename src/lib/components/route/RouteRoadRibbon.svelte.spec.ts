import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => {
	const inspectRoadSpan = vi.fn();
	const common = {
		roadClass: 'primary',
		use: 'road',
		surface: 'paved',
		cycleLane: null,
		bicycleNetwork: 0,
		weightedGrade: 1,
		maxUpwardGrade: 2,
		maxDownwardGrade: -1,
		meanElevationM: 100
	};
	return {
		inspectRoadSpan,
		route: {
			isReady: true,
			distanceLabel: '1.0 km',
			inspectRoadSpan,
			roadSpans: [
				{
					...common,
					wayId: 10,
					wayIds: [10],
					refs: ['DK10'],
					ref: 'DK10',
					displayLabel: 'DK10',
					name: 'Toruńska',
					roadKind: 'national',
					start: [18, 52],
					end: [18.01, 52.01],
					startM: 0,
					endM: 700,
					distanceM: 700,
					startShapeIndex: 0,
					endShapeIndex: 5
				},
				{
					...common,
					wayId: 20,
					wayIds: [20],
					refs: ['DW296'],
					ref: 'DW296',
					displayLabel: 'DW296',
					name: 'Kościuszki',
					roadKind: 'voivodeship',
					start: [18.01, 52.01],
					end: [18.02, 52.02],
					startM: 700,
					endM: 1000,
					distanceM: 300,
					startShapeIndex: 5,
					endShapeIndex: 8
				}
			]
		}
	};
});

vi.mock('#lib/state/route.svelte.js', () => ({ route: mocks.route }));

import RouteRoadRibbon from './RouteRoadRibbon.svelte';

afterEach(() => mocks.inspectRoadSpan.mockClear());

describe('RouteRoadRibbon', () => {
	it('renders proportional road segments without internal separators', async () => {
		render(RouteRoadRibbon);

		const toolbar = page.getByRole('group', { name: 'Route road segments' });
		const roads = toolbar.getByRole('button').all();
		expect(roads).toHaveLength(2);
		expect(roads[0]!.element().style.flexGrow).toBe('700');
		expect(roads[1]!.element().style.flexGrow).toBe('300');
		await expect.element(roads[0]!).not.toHaveClass(/border-l/);
		await expect.element(roads[1]!).not.toHaveClass(/border-l/);
		await expect
			.element(roads[0]!)
			.toHaveAccessibleName(/DK10, National road, 700 m, route kilometer 0.0 to 0.7/i);
	});

	it('supports focus, arrow-key navigation, tap pinning, and route inspection', async () => {
		render(RouteRoadRibbon);
		const roads = page
			.getByRole('group', { name: 'Route road segments' })
			.getByRole('button')
			.all();

		roads[0]!.element().focus();
		await expect.element(page.getByText('Toruńska')).toBeVisible();
		await expect.element(roads[0]!).toHaveClass(/ring-2/);
		expect(mocks.inspectRoadSpan).toHaveBeenLastCalledWith(0);

		await userEvent.keyboard('{ArrowRight}');
		await expect.element(roads[1]!).toHaveFocus();
		expect(mocks.inspectRoadSpan).toHaveBeenLastCalledWith(1);

		await roads[1]!.click();
		await expect.element(roads[1]!).toHaveAttribute('aria-pressed', 'true');
		await expect.element(page.getByText(/km 0.7–1.0/)).toBeVisible();
		await expect.element(page.getByText(/52.01000, 18.01000/)).toBeVisible();

		await userEvent.keyboard('{Escape}');
		await expect.element(roads[1]!).toHaveAttribute('aria-pressed', 'false');
		expect(mocks.inspectRoadSpan).toHaveBeenLastCalledWith(null);
	});

	it('identifies and styles a separated cycleway from Valhalla attributes', async () => {
		const span = mocks.route.roadSpans[0]!;
		const original = { ...span };
		Object.assign(span, {
			refs: [],
			ref: null,
			name: null,
			displayLabel: 'Cycleway',
			roadKind: 'other',
			roadClass: 'service_other',
			use: 'cycleway',
			cycleLane: 'separated',
			surface: 'paved_smooth'
		});

		try {
			render(RouteRoadRibbon);
			const cycleway = page.getByRole('button', {
				name: /Cycleway, 700 m, route kilometer 0.0 to 0.7/i
			});
			await expect.element(cycleway).toHaveClass(/bg-trail/);
			cycleway.element().focus();
			await expect.element(page.getByText('BIKE')).toBeVisible();
			await expect.element(page.getByText('Cycleway · Separated · Paved smooth')).toBeVisible();
			await expect.element(page.getByText('Service other')).not.toBeInTheDocument();
		} finally {
			Object.assign(span, original);
		}
	});
});
