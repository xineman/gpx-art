import type { ShapeType, Tool } from '$lib/types/sketch';

export function toolName(tool: Tool | ShapeType) {
	const names: Record<Tool, string> = {
		line: 'Line',
		pan: 'Pan',
		pencil: 'Pencil',
		polygon: 'Polygon',
		rectangle: 'Rectangle'
	};

	return names[tool];
}
