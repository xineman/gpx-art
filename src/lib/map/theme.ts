/** Resolve a `--color-*` token from `layout.css` @theme (MapLibre needs concrete values). */
export function themeColor(token: string): string {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(`--color-${token}`)
		.trim();
	if (!value) {
		throw new Error(`Missing theme color --color-${token} (is it in layout.css @theme static?)`);
	}
	return value;
}
