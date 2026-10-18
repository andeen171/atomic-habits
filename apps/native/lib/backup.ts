import { type ExportFile, toDayKey } from "@atomic/core";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Writes the export to the cache directory and opens the share sheet. */
export async function exportBackup(data: ExportFile, dialogTitle: string): Promise<void> {
	const file = new File(Paths.cache, `atomic-backup-${toDayKey()}.json`);
	if (file.exists) file.delete();
	file.create();
	file.write(JSON.stringify(data, null, 2));
	if (await Sharing.isAvailableAsync()) {
		await Sharing.shareAsync(file.uri, {
			mimeType: "application/json",
			UTI: "public.json",
			dialogTitle,
		});
	}
}

/** Lets the user pick a backup file; resolves to its parsed JSON (null when cancelled). */
export async function pickBackup(): Promise<unknown | null> {
	const result = await DocumentPicker.getDocumentAsync({
		type: ["application/json", "text/plain", "application/octet-stream"],
		copyToCacheDirectory: true,
		multiple: false,
	});
	if (result.canceled) return null;
	const asset = result.assets[0];
	if (!asset) return null;
	const text = await new File(asset.uri).text();
	return JSON.parse(text) as unknown;
}
