import { AUTO_REFINE_TIMEOUT_MS, MIN_VIAS } from '$lib/config/routing';
import type { RouteRequest, RouteResponse, RouteSuccess } from '../matching/types';
import { analyzeRouteDetours } from './detours';
import { applySelectionsToWaypointAnalysis } from './detour-coverage';
import {
	buildRefinementPlan,
	improvesDetourScore,
	routeRequestHash,
	scoreRouteDetours
} from './plan';

export type AutomaticRefinementOutcome = {
	response: RouteResponse;
	route: RouteSuccess;
	refined: boolean;
};

type AutomaticRefinementOptions = {
	timeoutMs?: number;
	now?: () => number;
};

/**
 * Refine a route locally until no request can improve its detour score.
 * The caller owns loading state, cancellation, and application of the returned best route.
 */
export async function refineRouteAutomatically(
	initialRoute: RouteSuccess,
	requestRoute: (request: RouteRequest) => Promise<RouteResponse>,
	options: AutomaticRefinementOptions = {}
): Promise<AutomaticRefinementOutcome> {
	const timeoutMs = options.timeoutMs ?? AUTO_REFINE_TIMEOUT_MS;
	const now = options.now ?? Date.now;
	const startedAt = now();
	let route = initialRoute;
	let refined = false;
	const seen = new Set<string>();

	while (now() - startedAt < timeoutMs) {
		const analysis = analyzeRouteDetours(route.geometry, route.waypoints);
		if (!analysis.some(({ candidate }) => candidate != null)) break;

		const analysisWithSelections = applySelectionsToWaypointAnalysis(analysis);
		const plan = buildRefinementPlan(route.geometry, route.waypoints, analysisWithSelections);
		if (plan.request.vias.length < MIN_VIAS) break;

		const previousScore = scoreRouteDetours(analysis, route.distanceM);
		if (previousScore.candidateCount === 0) break;

		const requestHash = routeRequestHash(plan.request);
		if (seen.has(requestHash)) break;
		seen.add(requestHash);

		const response = await requestRoute(plan.request);
		if (!response.ok) return { response, route, refined };

		const nextAnalysis = analyzeRouteDetours(response.geometry, response.waypoints);
		const nextScore = scoreRouteDetours(nextAnalysis, response.distanceM);
		if (!improvesDetourScore(nextScore, previousScore)) break;

		route = response;
		refined = true;
	}

	return { response: route, route, refined };
}
