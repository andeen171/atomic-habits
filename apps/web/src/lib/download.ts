/** Save a JSON value as a file (works in browsers, Tauri webviews and iframes). */
export function downloadJson(filename: string, value: unknown): void {
	const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.rel = "noopener";
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function readFileAsText(file: File): Promise<string> {
	return file.text();
}
