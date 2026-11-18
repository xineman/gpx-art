import { AUTO_REFINE_TIMEOUT_MS, MIN_VIAS } from '../config';
import type { RouteRequest, RouteResponse, RouteSuccess } from '../api/contracts';
import { introducesBacktracking } from './backtracking';
import { analyzeRouteDetours } from './detours';
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
 * Refine a route locally until no request can improve its detour score. A trial with new
 * backtracking can seed another pass, while only routes without new spurs are accepted.
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
	let accepted = initialRoute;
	let trial = initialRoute;
	let analysis = analyzeRouteDetours(trial.geometry, trial.waypoints);
	const seen = new Set<string>();

	while (now() - startedAt < timeoutMs) {
		const previousScore = scoreRouteDetours(analysis, trial.distanceM);
		if (previousScore.candidateCount === 0) break;

		let { request } = buildRefinementPlan(
			trial.geometry,
			trial.waypoints,
			analysis,
			[],
			trial.sourceVias
		);
		let requestHash = routeRequestHash(request);
		if (trial.sourceVias && seen.has(requestHash)) {
			// Source vias can repeat even after Valhalla snaps some waypoints to new positions.
			({ request } = buildRefinementPlan(trial.geometry, trial.waypoints, analysis));
			requestHash = routeRequestHash(request);
		}
		if (request.vias.length < MIN_VIAS || seen.has(requestHash)) break;
		seen.add(requestHash);

		const response = await requestRoute(request);
		if (!response.ok) return { response, route: accepted, refined: accepted !== initialRoute };

		const nextAnalysis = analyzeRouteDetours(response.geometry, response.waypoints);
		const nextScore = scoreRouteDetours(nextAnalysis, response.distanceM);
		if (!improvesDetourScore(nextScore, previousScore)) break;

		trial = response;
		analysis = nextAnalysis;
		if (!introducesBacktracking(accepted.geometry.coordinates, trial.geometry.coordinates)) {
			accepted = trial;
		}
	}

	return { response: accepted, route: accepted, refined: accepted !== initialRoute };
}
