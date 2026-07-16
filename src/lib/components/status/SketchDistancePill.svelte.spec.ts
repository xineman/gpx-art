import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { pointer } from '$lib/util/pointer.svelte';
import SketchDistancePill from './SketchDistancePill.svelte';

afterEach(() => {
	pointer.setFineHover(null);
});

describe('SketchDistancePill', () => {
	it('reveals its explanation on hover and keyboard focus', async () => {
		pointer.setFineHover(true);
		render(SketchDistancePill, { distanceLabel: '20.6 km' });

		const trigger = page.getByRole('button', {
			name: 'Sketch distance: 20.6 km. More information'
		});
		const tooltip = page.getByRole('tooltip');

		await expect
			.element(trigger)
			.toHaveAccessibleDescription(/route may differ because it follows bike roads/i);
		await expect.element(tooltip).toHaveClass('invisible');

		await trigger.hover();
		await expect.element(tooltip).toHaveClass('visible');

		await trigger.unhover();
		trigger.element().focus();
		await expect.element(tooltip).toHaveClass('visible');

		await userEvent.keyboard('{Escape}');
		await expect.element(tooltip).toHaveClass('invisible');
	});

	it('toggles on touch and closes on an outside tap', async () => {
		pointer.setFineHover(false);
		render(SketchDistancePill, { distanceLabel: '20.6 km' });

		const trigger = page.getByRole('button', {
			name: 'Sketch distance: 20.6 km. More information'
		});
		const tooltip = page.getByRole('tooltip');

		await trigger.click();
		await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');
		await expect.element(tooltip).toHaveClass('visible');

		await userEvent.click(document.body);
		await expect.element(trigger).toHaveAttribute('aria-expanded', 'false');
		await expect.element(tooltip).toHaveClass('invisible');
	});
});
