import { type ExportFile, toDayKey } from "@atomic/core";
import * as DocumentPicker from "expo-document-picker";

/** Downloads the export as a JSON file. */
export async function exportBackup(data: ExportFile, _dialogTitle: string): Promise<void> {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `atomic-backup-${toDayKey()}.json`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function pickBackup(): Promise<unknown | null> {
	const result = await DocumentPicker.getDocumentAsync({
		type: "application/json",
		multiple: false,
	});
	if (result.canceled) return null;
	const asset = result.assets[0];
	if (!asset) return null;
	const text = asset.file ? await asset.file.text() : await (await fetch(asset.uri)).text();
	return JSON.parse(text) as unknown;
}
