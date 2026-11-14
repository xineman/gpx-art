import type { ToolId } from './types';

export type ToolDef = {
	id: ToolId;
	label: string;
	/** Mouse / hover-tooltip wording. */
	hint: string;
	/** Status-bar wording on touch / coarse pointers (no hover). */
	touchHint: string;
	shortcut: string;
};

export const TOOLS: readonly ToolDef[] = [
	{
		id: 'pencil',
		label: 'Pencil',
		hint: 'Freehand trail',
		touchHint: 'Freehand trail',
		shortcut: 'P'
	},
	{
		id: 'polyline',
		label: 'Polyline',
		hint: 'Click vertices · double-click or Enter to finish',
		touchHint: 'Tap vertices · double-tap last point to finish',
		shortcut: 'L'
	},
	{
		id: 'polygon',
		label: 'Polygon',
		hint: 'Click vertices · double-click or Enter to close',
		touchHint: 'Tap vertices · double-tap last point to close',
		shortcut: 'G'
	},
	{
		id: 'rectangle',
		label: 'Rectangle',
		hint: 'Drag to place a box',
		touchHint: 'Drag to place a box',
		shortcut: 'R'
	},
	{
		id: 'pan',
		label: 'Pan',
		hint: 'Drag the map · hold Space to pan',
		touchHint: 'Drag the map',
		shortcut: 'H'
	}
] as const;

export function toolById(id: string): ToolDef | undefined {
	return TOOLS.find((t) => t.id === id);
}
