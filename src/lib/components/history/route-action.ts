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
	moveWaypointCount: number;
	removeWaypointCount: number;
	canRefineRoute: boolean;
};

function actionDescription(action: 'move' | 'remove', count: number): string {
	return `${action} ${count} ${count === 1 ? 'waypoint' : 'waypoints'}`;
}

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
		const actionCount = input.moveWaypointCount + input.removeWaypointCount;
		if (actionCount > 0) {
			if (input.canRefineRoute) {
				const actions = [
					input.moveWaypointCount > 0 ? actionDescription('move', input.moveWaypointCount) : null,
					input.removeWaypointCount > 0
						? actionDescription('remove', input.removeWaypointCount)
						: null
				].filter((action): action is string => action != null);
				return {
					kind: 'refine',
					label: `Refine ${actionCount}`,
					ariaLabel: `Refine route: ${actions.join(' and ')}`
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
