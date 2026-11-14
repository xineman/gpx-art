/** Session-scoped preferences shared by the desktop and mobile route controls. */
class RoutingOptionsState {
	#autoRefineOnGenerate = $state(true);

	get autoRefineOnGenerate() {
		return this.#autoRefineOnGenerate;
	}
	setAutoRefineOnGenerate(value: boolean) {
		this.#autoRefineOnGenerate = value;
	}
}

export const routingOptions = new RoutingOptionsState();
