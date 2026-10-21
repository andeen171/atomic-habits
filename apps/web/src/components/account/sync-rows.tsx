import { useT } from "@/lib/messages";
import { syncController } from "@/lib/sync";
import { useActions, useSettings, useSyncState } from "@atomic/core/react";
import { SettingsRow } from "../settings/settings-section";
import { Switch } from "../ui/switch";

/**
 * The device's sync switches (spec §5.9):
 * - "Sync journal" (D19, `settings.syncJournal`): off keeps entries written
 *   here on this device; entries from other devices still arrive. Shown
 *   signed out too, so it can be turned off before the first sign-in.
 * - "Back up photos" (D23, `settings.backupPhotos`): only signed in to a
 *   server with photo backup, with the backup's state underneath.
 *
 * Rendered as rows inside a settings card. Owner: T5.
 */
export function SyncSwitchRows() {
	const { t } = useT();
	const settings = useSettings();
	const actions = useActions();
	const sync = useSyncState(syncController);
	const blobs = sync.user && sync.server?.features.blobs ? sync.blobs : null;
	const photosOffered = !!sync.user && !!sync.server?.features.blobs;

	return (
		<>
			<SettingsRow
				label={t("sync.journal")}
				hint={t("sync.journalHint")}
				htmlFor="sync-journal"
				className="scroll-mt-24"
			>
				<Switch
					id="sync-journal"
					checked={settings.syncJournal}
					onCheckedChange={(syncJournal) => actions.updateSettings({ syncJournal })}
				/>
			</SettingsRow>
			{photosOffered ? (
				<SettingsRow
					label={t("sync.backupPhotos")}
					hint={
						<>
							{t("sync.backupPhotosHint")}
							{settings.backupPhotos && blobs ? <PhotoBackupState blobs={blobs} /> : null}
						</>
					}
					htmlFor="sync-photos"
				>
					<Switch
						id="sync-photos"
						checked={settings.backupPhotos}
						onCheckedChange={(backupPhotos) => actions.updateSettings({ backupPhotos })}
					/>
				</SettingsRow>
			) : null}
		</>
	);
}

function PhotoBackupState({
	blobs,
}: {
	blobs: NonNullable<ReturnType<typeof syncController.getState>["blobs"]>;
}) {
	const { t } = useT();
	const text =
		blobs.state === "quota"
			? t("plan.storageFull")
			: blobs.state === "error"
				? t("sync.photosError")
				: blobs.waiting > 0
					? t.tp("sync.photosWaiting", blobs.waiting)
					: null;
	if (!text) return null;
	return (
		<span
			className={
				blobs.state === "quota" || blobs.state === "error"
					? "mt-1 block font-medium text-ink"
					: "mt-1 block"
			}
		>
			{text}
		</span>
	);
}
