import { MIN_VIAS } from '$lib/config/routing';
import type { RouteLoadingAction, RouteStatus } from '$lib/state/route.svelte';

export type RouteActionKind = 'route' | 'refine' | 'ready' | 'keep' | 'loading';

export type RouteActionModel = {
	kind: RouteActionKind;
	label: string;
	ariaLabel: string;
};

type RouteActionInput = {
	status: RouteStatus;
	loadingAction: RouteLoadingAction;
	hasSketch: boolean;
	markedWaypointCount: number;
	canRefineRoute: boolean;
};

/** Pure view model for the route cartridge's adaptive primary segment. */
export function routeActionModel(input: RouteActionInput): RouteActionModel {
	if (input.status === 'loading') {
		switch (input.loadingAction) {
			case 'refine':
				return { kind: 'loading', label: 'Refining', ariaLabel: 'Refining route…' };
			case 'reset':
				return { kind: 'loading', label: 'Restoring', ariaLabel: 'Restoring sketch route…' };
			default:
				return { kind: 'loading', label: 'Routing', ariaLabel: 'Routing…' };
		}
	}

	if (input.status === 'ready') {
		if (input.markedWaypointCount > 0) {
			if (input.canRefineRoute) {
				const noun = input.markedWaypointCount === 1 ? 'waypoint' : 'waypoints';
				return {
					kind: 'refine',
					label: `Refine ${input.markedWaypointCount}`,
					ariaLabel: `Refine route around ${input.markedWaypointCount} marked ${noun}`
				};
			}
			return {
				kind: 'keep',
				label: `Keep ${MIN_VIAS}`,
				ariaLabel: `Keep at least ${MIN_VIAS} distinct waypoints to refine the route`
			};
		}

		return { kind: 'ready', label: 'Ready', ariaLabel: 'Route ready' };
	}

	return {
		kind: 'route',
		label: 'Route',
		ariaLabel: input.hasSketch ? 'Route' : 'Route — sketch a shape first'
	};
}
