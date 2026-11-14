import type { Position } from 'geojson';
import type { RouteFailure } from '../api/failure';
import type { MatrixSuccess } from './matrix-response';

export type MatrixRequest = {
	coordinates: Position[];
};

export type MatrixResponse = MatrixSuccess | RouteFailure;
