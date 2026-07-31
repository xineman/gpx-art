export type WaypointRefinementAction = 'keep' | 'move' | 'remove';

export type WaypointActionSelection = {
	waypointIndex: number;
	action: WaypointRefinementAction;
};
