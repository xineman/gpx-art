import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Geometry } from 'geojson';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { DrawingController, type DraftSnapshot } from './controller';

type Handler = (event: never) => void;

class FakeMap {
	readonly handlers = new Map<string, Handler>();
	readonly dragPan = { enable: vi.fn(), disable: vi.fn() };
	readonly doubleClickZoom = { enable: vi.fn(), disable: vi.fn() };
	readonly canvas = {
		style: { cursor: '' },
		getBoundingClientRect: () => ({ left: 0, top: 0 })
	};

	on(name: string, handler: Handler) {
		this.handlers.set(name, handler);
	}

	off(name: string) {
		this.handlers.delete(name);
	}

	emit(name: string, event: unknown) {
		this.handlers.get(name)?.(event as never);
	}

	getLayer() {
		return undefined;
	}

	getSource() {
		return undefined;
	}

	getCanvas() {
		return this.canvas;
	}

	project(point: { lng: number; lat: number }) {
		return { x: point.lng, y: point.lat };
	}

	unproject(point: [number, number]) {
		return { lng: point[0], lat: point[1] };
	}
}

function mouseEvent(x: number, y: number, detail = 1) {
	return {
		point: { x, y },
		lngLat: { lng: x, lat: y },
		originalEvent: { button: 0, detail },
		preventDefault: vi.fn()
	};
}

describe('DrawingController', () => {
	let map: FakeMap;
	let commits: Array<{ geometry: Geometry; tool: string }>;
	let drafts: Array<DraftSnapshot | null>;
	let windowHandlers: Map<string, (event: KeyboardEvent) => void>;
	let controller: DrawingController;

	beforeEach(() => {
		map = new FakeMap();
		commits = [];
		drafts = [];
		windowHandlers = new Map();
		vi.stubGlobal('window', {
			addEventListener: vi.fn((name: string, handler: (event: KeyboardEvent) => void) => {
				windowHandlers.set(name, handler);
			}),
			removeEventListener: vi.fn((name: string) => windowHandlers.delete(name))
		});
		controller = new DrawingController(
			map as unknown as MaplibreMap,
			(geometry, tool) => commits.push({ geometry, tool }),
			(draft) => drafts.push(draft)
		);
		controller.attach();
	});

	afterEach(() => {
		controller.detach();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function click(x: number, y: number, detail = 1) {
		map.emit('click', mouseEvent(x, y, detail));
	}

	function pressEnter() {
		windowHandlers.get('keydown')?.({ key: 'Enter' } as KeyboardEvent);
	}

	it('commits a near-closed pencil stroke as a closed LineString', () => {
		map.emit('mousedown', mouseEvent(0, 0));
		map.emit('mousemove', mouseEvent(100, 0));
		map.emit('mousemove', mouseEvent(5, 5));
		map.emit('mouseup', mouseEvent(5, 5));

		expect(commits).toHaveLength(1);
		expect(commits[0]).toMatchObject({ tool: 'pencil', geometry: { type: 'LineString' } });
		expect(commits[0]!.geometry).toHaveProperty('coordinates', [
			[0, 0],
			[100, 0],
			[5, 5],
			[0, 0]
		]);
	});

	it('infers polyline closure when Enter finishes nearby endpoints', () => {
		controller.setTool('polyline');
		click(0, 0);
		click(100, 0);
		click(5, 5);
		pressEnter();

		expect(commits).toHaveLength(1);
		expect(commits[0]).toMatchObject({ tool: 'polyline', geometry: { type: 'LineString' } });
		expect(commits[0]!.geometry).toHaveProperty('coordinates', [
			[0, 0],
			[100, 0],
			[5, 5],
			[0, 0]
		]);
	});

	it('keeps a distant polyline open when Enter finishes it', () => {
		controller.setTool('polyline');
		click(0, 0);
		click(100, 0);
		click(100, 100);
		pressEnter();

		expect(commits[0]!.geometry).toHaveProperty('coordinates', [
			[0, 0],
			[100, 0],
			[100, 100]
		]);
	});

	it('commits polygon and rectangle tools as closed LineStrings', () => {
		controller.setTool('polygon');
		click(0, 0);
		click(100, 0);
		click(100, 100);
		pressEnter();

		controller.setTool('rectangle');
		map.emit('mousedown', mouseEvent(10, 20));
		map.emit('mouseup', mouseEvent(30, 40));

		expect(commits).toHaveLength(2);
		expect(commits.map(({ geometry }) => geometry.type)).toEqual(['LineString', 'LineString']);
		expect(commits[0]!.geometry).toHaveProperty('coordinates.3', [0, 0]);
		expect(commits[1]!.geometry).toHaveProperty('coordinates.4', [10, 20]);
	});

	it('does not start a stray draft after double-clicking the first vertex', () => {
		vi.spyOn(performance, 'now')
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(100)
			.mockReturnValueOnce(200)
			.mockReturnValueOnce(300)
			// Deliberately beyond DOUBLE_TAP_MS; native click detail still identifies the pair.
			.mockReturnValueOnce(1000)
			.mockReturnValue(1100);
		controller.setTool('polyline');
		click(0, 0);
		click(100, 0);
		click(100, 100);

		click(0, 0);
		click(0, 0, 2);
		map.emit('dblclick', mouseEvent(0, 0));

		expect(commits).toHaveLength(1);
		expect(drafts.at(-1)).toBeNull();

		click(200, 200);
		expect(drafts.at(-1)).toMatchObject({ tool: 'polyline', vertexCount: 1 });
	});

	it('does not start a stray draft after double-clicking the existing last vertex', () => {
		controller.setTool('polyline');
		click(0, 0);
		click(100, 0);
		click(100, 100);

		click(100, 100);
		click(100, 100, 2);
		map.emit('dblclick', mouseEvent(100, 100));

		expect(commits).toHaveLength(1);
		expect(drafts.at(-1)).toBeNull();
	});

	it('commits exactly once when double-clicking a new endpoint', () => {
		controller.setTool('polyline');
		click(0, 0);
		click(100, 0);
		click(100, 100);

		click(200, 200);
		click(200, 200, 2);
		map.emit('dblclick', mouseEvent(200, 200));

		expect(commits).toHaveLength(1);
		expect(drafts.at(-1)).toBeNull();
	});
});
