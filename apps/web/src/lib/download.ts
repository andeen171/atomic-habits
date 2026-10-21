import { saveThroughViewer } from "./artifact-cloud";
import { isTauri } from "./client-info";
import { isArtifactBuild } from "./runtime";

/**
 * Save a JSON value as a file. Browsers and Tauri webviews get a regular
 * download; the Artifact build asks the viewer through its download prompt
 * (pages there cannot start downloads themselves). Resolves false when the
 * file could not be offered.
 */
export async function downloadJson(filename: string, value: unknown): Promise<boolean> {
	const json = JSON.stringify(value, null, 2);
	if (isArtifactBuild) return saveThroughViewer(filename, json);
	return downloadBlob(filename, new Blob([json], { type: "application/json" }));
}

/** Save a blob as a file (regular browser download). */
export function downloadBlob(filename: string, blob: Blob): boolean {
	const url = URL.createObjectURL(blob);
	clickLink(url, filename);
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
	return true;
}

/**
 * Download a file the server serves as an attachment (the account export
 * link, D69). The page stays where it is; desktop hands the link to the
 * system browser.
 */
export async function downloadUrl(url: string): Promise<void> {
	if (isTauri) {
		const { openUrl } = await import("@tauri-apps/plugin-opener");
		await openUrl(url);
		return;
	}
	clickLink(url, "");
}

function clickLink(href: string, filename: string): void {
	const link = document.createElement("a");
	link.href = href;
	link.download = filename;
	link.rel = "noopener";
	document.body.appendChild(link);
	link.click();
	link.remove();
}
