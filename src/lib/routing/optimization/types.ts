import type { Position } from 'geojson';
import type { RouteFailure } from '../shared/failure';

export type MatrixRequest = {
	coordinates: Position[];
};

export type MatrixSuccess = {
	ok: true;
	distances: (number | null)[][];
};

export type MatrixResponse = MatrixSuccess | RouteFailure;
