import { Download } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { kv } from "@/lib/kv";
import { syncController } from "@/lib/sync";
import type { UpdateInfo } from "@atomic/core";
import { useSyncState } from "@atomic/core/react";
import { Linking, Platform } from "react-native";
import { create } from "zustand";
import { Notice } from "./account-ui";

/** The version whose banner was dismissed (spec §6). */
export const UPDATE_DISMISS_KEY = "atomic-habits:update-dismissed";

const useDismissedVersion = create<{ version: string | null; dismiss(version: string): void }>(
	(set) => ({
		version: null,
		dismiss(version) {
			set({ version });
			Promise.resolve(kv.setItem(UPDATE_DISMISS_KEY, version)).catch(() => {
				// Remembered until the app restarts.
			});
		},
	}),
);

// Read once at startup; a dismissal made before it lands still wins.
Promise.resolve(kv.getItem(UPDATE_DISMISS_KEY))
	.then((stored) => {
		if (stored && useDismissedVersion.getState().version === null)
			useDismissedVersion.setState({ version: stored });
	})
	.catch(() => {});

/**
 * A newer sideloaded Android build (`ServerInfo.clients.android` newer than
 * this app), unless its banner was dismissed. Null everywhere else.
 */
export function useUpdateOffer(): UpdateInfo | null {
	const sync = useSyncState(syncController);
	const dismissed = useDismissedVersion((s) => s.version);
	const update = sync.updateAvailable;
	if (Platform.OS !== "android" || !update) return null;
	return update.version === dismissed ? null : update;
}

/**
 * Android: "Atomic {version} is available · Download" when
 * `ServerInfo.clients.android.version` is newer than the app (spec §6; the
 * web app updates itself, §1.3). "Download" opens the APK link; dismissing
 * hides it until the next version. Rendered by `CloudBanners`. Owner: T5.
 */
export function UpdateBanner() {
	const t = useT();
	const update = useUpdateOffer();
	const dismiss = useDismissedVersion((s) => s.dismiss);
	if (!update) return null;
	return (
		<Notice
			tone="info"
			icon={Download}
			floating
			title={t.t("account.updateAvailable", { version: update.version })}
			onDismiss={() => dismiss(update.version)}
			testID="update-banner"
			actions={
				<Button
					label={t.t("account.updateAction")}
					icon={Download}
					variant="primary"
					size="sm"
					onPress={() => {
						haptics.selection();
						void Linking.openURL(update.url);
					}}
					testID="update-download"
				/>
			}
		/>
	);
}
