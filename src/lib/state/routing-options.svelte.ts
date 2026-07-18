/** Session-scoped preferences shared by the desktop and mobile route controls. */
let autoRefineOnGenerate = $state(true);

export const routingOptions = {
	get autoRefineOnGenerate() {
		return autoRefineOnGenerate;
	},
	setAutoRefineOnGenerate(value: boolean) {
		autoRefineOnGenerate = value;
	}
};
