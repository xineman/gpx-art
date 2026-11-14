import type { RouteFailure } from '../shared/failure';
import type { RouteAttributionSuccess } from './attributes-response';

export type {
	AttributedRouteEdge,
	RouteAttributionSuccess,
	RouteRoadAttributes,
	RouteRoadKind,
	RouteRoadSpan
} from './attributes-response';

export type RouteAttributionResponse = RouteAttributionSuccess | RouteFailure;
