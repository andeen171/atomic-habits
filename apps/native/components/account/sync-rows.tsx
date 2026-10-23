import { trackerCaps } from "@/components/trackers/caps";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { photoStoreAvailable } from "@/lib/blob-store";
import { useT } from "@/lib/i18n";
import { syncController } from "@/lib/sync";
import { makeStyles } from "@/lib/theme";
import type { BlobSyncState } from "@atomic/core";
import { useActions, useSettings, useSyncState } from "@atomic/core/react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Divider } from "./account-ui";

/**
 * The device's sync switches (spec §5.9, §6):
 * - "Sync journal" (D19, `settings.syncJournal`): off keeps entries written
 *   here on this device; entries from other devices still arrive. Shown
 *   signed out too, so it can be turned off before the first sign-in.
 * - "Back up photos" (D23, `settings.backupPhotos`): only signed in to a
 *   server with photo backup, on a device that can keep photos, with the
 *   backup's state underneath. Signed out, on a device that keeps photos,
 *   the row says they live only here (`sync.photosNotInBackups`; JSON
 *   backups never hold photos), as on web.
 *
 * Rows for a card; `leadingDivider` draws the hairline above the first.
 * Owner: T5.
 */
export function SyncSwitchRows({ leadingDivider }: { leadingDivider?: boolean }) {
	const t = useT();
	const settings = useSettings();
	const actions = useActions();
	const sync = useSyncState(syncController);
	// Offered as soon as the server backs photos up (the first pass fills in its state).
	const photosOffered = !!sync.user && !!sync.server?.features.blobs && photoStoreAvailable();
	const blobs = photosOffered ? sync.blobs : null;
	const photosOnlyHere = usePhotosOnlyHere();

	return (
		<>
			{leadingDivider ? <Divider /> : null}
			<SwitchRow
				title={t.t("sync.journal")}
				hint={t.t("sync.journalHint")}
				value={settings.syncJournal}
				onChange={(syncJournal) => actions.updateSettings({ syncJournal })}
				testID="sync-journal"
			/>
			{photosOffered ? (
				<>
					<Divider />
					<SwitchRow
						title={t.t("sync.backupPhotos")}
						hint={t.t("sync.backupPhotosHint")}
						extra={settings.backupPhotos && blobs ? <PhotoBackupState blobs={blobs} /> : null}
						value={settings.backupPhotos}
						onChange={(backupPhotos) => actions.updateSettings({ backupPhotos })}
						testID="sync-photos"
					/>
				</>
			) : photosOnlyHere ? (
				<>
					<Divider />
					<NoteRow title={t.t("sync.backupPhotos")} hint={t.t("sync.photosNotInBackups")} />
				</>
			) : null}
		</>
	);
}

/**
 * Photos this device keeps exist only here: photos are possible on this
 * device (`trackerCaps`) and nobody is signed in to back them up. The export
 * row and the sync switches then say JSON backups leave them out.
 */
export function usePhotosOnlyHere(): boolean {
	const signedIn = useSyncState(syncController).user !== null;
	return !signedIn && trackerCaps().photos;
}

function NoteRow({ title, hint }: { title: string; hint: string }) {
	const styles = useStyles();
	return (
		<View style={styles.row} accessible testID="sync-photos-note">
			<View style={styles.text}>
				<Text weight="medium">{title}</Text>
				<Text variant="small" tone="muted">
					{hint}
				</Text>
			</View>
		</View>
	);
}

function SwitchRow({
	title,
	hint,
	extra,
	value,
	onChange,
	testID,
}: {
	title: string;
	hint: string;
	extra?: ReactNode;
	value: boolean;
	onChange(value: boolean): void;
	testID?: string;
}) {
	const styles = useStyles();
	return (
		<View style={styles.row}>
			<View style={styles.text}>
				<Text weight="medium">{title}</Text>
				<Text variant="small" tone="muted">
					{hint}
				</Text>
				{extra}
			</View>
			<Switch value={value} onValueChange={onChange} accessibilityLabel={title} testID={testID} />
		</View>
	);
}

function PhotoBackupState({ blobs }: { blobs: BlobSyncState }) {
	const t = useT();
	const text =
		blobs.state === "quota"
			? t.t("plan.storageFull")
			: blobs.state === "error"
				? t.t("sync.photosError")
				: blobs.waiting > 0
					? t.tp("sync.photosWaiting", blobs.waiting)
					: null;
	if (!text) return null;
	const strong = blobs.state === "quota" || blobs.state === "error";
	return (
		<Text
			variant="small"
			weight={strong ? "medium" : "regular"}
			tone={strong ? "default" : "muted"}
			style={{ marginTop: 2 }}
		>
			{text}
		</Text>
	);
}

const useStyles = makeStyles(() => ({
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		paddingHorizontal: 16,
		paddingVertical: 14,
		minHeight: 60,
	},
	text: { flex: 1, gap: 2 },
}));
