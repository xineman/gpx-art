import { describe, expect, it } from 'vitest';
import { DrawingSession } from './session';

describe('drawing session', () => {
	it('checks endpoint proximity using the current projection when finishing', () => {
		let scale = 1;
		const session = new DrawingSession(([x, y]) => ({ x: x * scale, y: y * scale }));
		session.dispatch({ type: 'selectTool', tool: 'polyline' });
		session.dispatch({ type: 'tap', position: [0, 0], time: 0, clickCount: 1 });
		session.dispatch({ type: 'tap', position: [100, 100], time: 100, clickCount: 1 });
		session.dispatch({ type: 'tap', position: [100, 0], time: 200, clickCount: 1 });

		scale = 0.1;
		expect(session.dispatch({ type: 'finish' })?.commit?.geometry.coordinates).toEqual([
			[0, 0],
			[100, 100],
			[100, 0],
			[0, 0]
		]);
	});
});
