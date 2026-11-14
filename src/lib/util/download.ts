/**
 * Trigger a browser file download. No-op-safe only in DOM environments.
 */
export function downloadTextFile(
	filename: string,
	text: string,
	mime = 'application/geo+json'
): void {
	const blob = new Blob([text], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.rel = 'noopener';
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
