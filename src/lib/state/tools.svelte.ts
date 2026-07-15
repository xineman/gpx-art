export type ToolId = 'pencil' | 'polyline' | 'polygon' | 'rectangle' | 'pan';

export const TOOLS = [
	{
		id: 'pencil' as const,
		label: 'Pencil',
		hint: 'Freehand trail',
		shortcut: 'P'
	},
	{
		id: 'polyline' as const,
		label: 'Polyline',
		hint: 'Click vertices · double-click to finish',
		shortcut: 'L'
	},
	{
		id: 'polygon' as const,
		label: 'Polygon',
		hint: 'Click vertices · double-click to close',
		shortcut: 'G'
	},
	{
		id: 'rectangle' as const,
		label: 'Rectangle',
		hint: 'Drag to place a box',
		shortcut: 'R'
	},
	{
		id: 'pan' as const,
		label: 'Pan',
		hint: 'Drag the map · hold Space to pan',
		shortcut: 'H'
	}
] as const;

/**
 * Shared tool selection. Module-level runes (not a class) so every
 * importer shares the same reactive signals — avoids silent desync
 * between the tools panel and DrawingLayer.
 */
let active = $state<ToolId>('pencil');
let spaceHeld = $state(false);

export const tools = {
	get active() {
		return active;
	},
	get spaceHeld() {
		return spaceHeld;
	},
	/** Tool that actually drives interaction right now. */
	get effective(): ToolId {
		return spaceHeld ? 'pan' : active;
	},
	get isPanning() {
		return spaceHeld || active === 'pan';
	},
	select(tool: ToolId) {
		active = tool;
		// Selecting a tool ends temporary space-pan so the panel stays truthful
		spaceHeld = false;
	},
	pressSpace() {
		spaceHeld = true;
	},
	releaseSpace() {
		spaceHeld = false;
	}
};
