import { describe, expect, it } from 'vitest';
import { routeActionModel } from './route-action';

const base = {
	status: 'idle' as const,
	loadingAction: null,
	hasSketch: true,
	markedWaypointCount: 0,
	canRefineRoute: false
};

describe('routeActionModel', () => {
	it('describes initial enabled and disabled route actions', () => {
		expect(routeActionModel(base)).toMatchObject({ kind: 'route', label: 'Route' });
		expect(routeActionModel({ ...base, hasSketch: false }).ariaLabel).toBe(
			'Route — sketch a shape first'
		);
	});

	it('counts marked waypoints in the refinement action and accessible label', () => {
		expect(
			routeActionModel({
				...base,
				status: 'ready',
				markedWaypointCount: 3,
				canRefineRoute: true
			})
		).toEqual({
			kind: 'refine',
			label: 'Refine 3',
			ariaLabel: 'Refine route around 3 marked waypoints'
		});
	});

	it('uses passive ready and minimum-waypoint states', () => {
		expect(routeActionModel({ ...base, status: 'ready' })).toMatchObject({
			kind: 'ready',
			label: 'Ready'
		});
		expect(routeActionModel({ ...base, status: 'ready', markedWaypointCount: 2 })).toEqual({
			kind: 'keep',
			label: 'Keep 2',
			ariaLabel: 'Keep at least 2 distinct waypoints to refine the route'
		});
	});

	it.each([
		['generate', 'Routing', 'Routing…'],
		['refine', 'Refining', 'Refining route…'],
		['reset', 'Restoring', 'Restoring sketch route…']
	] as const)('describes the %s loading action', (loadingAction, label, ariaLabel) => {
		expect(routeActionModel({ ...base, status: 'loading', loadingAction })).toEqual({
			kind: 'loading',
			label,
			ariaLabel
		});
	});
});
