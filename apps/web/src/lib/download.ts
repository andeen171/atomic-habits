import { saveThroughViewer } from "./artifact-cloud";
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
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.rel = "noopener";
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
	return true;
}
