import { Server } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { askExistingData, useAuthSheet } from "@/lib/account";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { officialServerUrl, syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { accountErrorKey } from "@atomic/core";
import { useSyncState } from "@atomic/core/react";
import { useState } from "react";
import { View } from "react-native";
import { serverName } from "./format";
import { GoogleButton, googleOffered } from "./google-button";
import { useServerInfo } from "./use-server-info";

/**
 * Signed out (Annex C §5): Continue with Google (where the server offers
 * it), Sign in and Create account, and the server line "Server: Atomic
 * Cloud · Use a different server". Used by Settings → Account & sync and
 * the Account screen. Owner: T5.
 */
export function SignedOutPanel() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const openAuth = useAuthSheet((s) => s.openAuth);
	const sync = useSyncState(syncController);
	const server = useServerInfo(sync.serverUrl, 0);
	const [pending, setPending] = useState(false);
	const google = googleOffered(server.info);

	const onGoogle = async (idToken: string) => {
		const url = sync.serverUrl;
		if (!url || pending) return;
		setPending(true);
		try {
			const outcome = await syncController.signInWithGoogle(url, idToken, undefined, {
				onExistingData: askExistingData,
			});
			const user = syncController.getState().user;
			if (outcome === "signed-in") {
				haptics.success();
				showToast(t.t("settings.signedInAs", { email: user?.email ?? "" }), { tone: "success" });
			} else showToast(t.t("account.signInCanceled"));
		} catch (error) {
			haptics.warning();
			showToast(t.t(accountErrorKey(error)), { tone: "danger" });
		} finally {
			setPending(false);
		}
	};

	return (
		<View style={styles.panel}>
			<View style={styles.buttons}>
				{google ? (
					<GoogleButton
						server={server.info}
						onToken={(token) => void onGoogle(token)}
						disabled={pending}
					/>
				) : null}
				<Button
					label={t.t("settings.signIn")}
					size="lg"
					disabled={pending}
					onPress={() => openAuth("signIn")}
					testID="account-sign-in"
				/>
				<Button
					label={t.t("settings.signUp")}
					variant="secondary"
					size="lg"
					disabled={pending}
					onPress={() => openAuth("signUp")}
					testID="account-sign-up"
				/>
			</View>
			{officialServerUrl || sync.serverUrl ? (
				<View style={styles.serverLine}>
					<Server size={15} color={colors.textMuted} strokeWidth={2} />
					<Text variant="small" tone="muted" style={styles.serverText}>
						{t.t("account.serverLine", {
							server: serverName(sync.serverUrl, officialServerUrl, t.t("account.serverOfficial")),
						})}
					</Text>
					<PressableScale
						onPress={() => openAuth("signIn", { advanced: true })}
						hitSlop={10}
						accessibilityRole="button"
						accessibilityLabel={t.t("account.serverChange")}
						testID="account-server-change"
					>
						<Text variant="small" weight="semibold" tone="accent">
							{t.t("account.serverChange")}
						</Text>
					</PressableScale>
				</View>
			) : null}
		</View>
	);
}

const useStyles = makeStyles(() => ({
	panel: { gap: 16 },
	buttons: { gap: 10 },
	serverLine: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		columnGap: 8,
		rowGap: 4,
	},
	serverText: { flexShrink: 1 },
}));
