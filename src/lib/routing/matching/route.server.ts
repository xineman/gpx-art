import type { RouteRequest, RouteResponse } from './types';
import { fetchValhallaTrace } from '../providers/valhalla/trace.server';
import type { ValhallaConfig } from '../providers/valhalla/types.server';

export type GenerateRouteOptions = {
	valhalla: ValhallaConfig;
};

/**
 * Server pipeline: ordered prepared vias → one continuous Valhalla map match.
 */
export async function generateRoute(
	request: RouteRequest,
	options: GenerateRouteOptions
): Promise<RouteResponse> {
	const matched = await fetchValhallaTrace(request, options.valhalla);
	if (!matched.ok) return matched;

	return {
		ok: true,
		geometry: matched.geometry,
		distanceM: matched.distanceM,
		waypoints: matched.waypoints
	};
}
