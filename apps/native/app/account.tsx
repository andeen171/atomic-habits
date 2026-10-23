import { AiSettingsSection } from "@/components/account/ai-settings-section";
import { DangerSection } from "@/components/account/danger-section";
import { DataSection } from "@/components/account/data-section";
import { PlanSection } from "@/components/account/plan-section";
import { ProfileSection } from "@/components/account/profile-section";
import { SecuritySection } from "@/components/account/security-section";
import { SignedOutPanel } from "@/components/account/signed-out-panel";
import { SyncSection } from "@/components/account/sync-section";
import { VerifyNotice } from "@/components/account/verify-notice";
import { CloudUpload } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { accountController } from "@/lib/account";
import { useT } from "@/lib/i18n";
import { syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import { useSyncState } from "@atomic/core/react";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

/**
 * The Account screen (Annex C §5, spec §6). Signed in: plan and usage,
 * the AI assistant (Beta, when the server has AI), sync, profile, security
 * (password, devices), your data (export, refused and newer-version items)
 * and sign out / delete, under one "Verify your email" notice while the
 * address is unconfirmed. Signed out: the sign-in choices and the device's
 * sync switches. Opening it refreshes the account, so the plan and usage
 * are current (the first backup may have finished since sign-in).
 * Owner: T5.
 */
export default function AccountScreen() {
	const t = useT();
	const sync = useSyncState(syncController);
	const styles = useStyles();
	const signedIn = sync.user !== null;
	useFocusEffect(
		useCallback(() => {
			if (signedIn) void accountController.refresh().catch(() => null);
		}, [signedIn]),
	);
	return (
		<Screen back title={t.t("account.title")} keyboard testID="account-screen">
			<ScreenTitle title={t.t("account.title")} subtitle={sync.user?.email} />
			{sync.user ? (
				<>
					{/* Recovery, AI and upgrades all wait for a confirmed email. */}
					<VerifyNotice style={styles.verify} />
					<PlanSection />
					<AiSettingsSection />
					<SyncSection />
					<ProfileSection />
					<SecuritySection />
					<DataSection />
					<DangerSection />
				</>
			) : (
				<>
					<SignedOutHero />
					<SyncSection />
				</>
			)}
		</Screen>
	);
}

function SignedOutHero() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<Card padding={20} style={styles.hero} testID="account-hero">
			<View style={styles.heroHead}>
				<View style={[styles.heroIcon, { backgroundColor: colors.accentSoft }]}>
					<CloudUpload size={24} color={colors.accentText} strokeWidth={2} />
				</View>
				<View style={styles.heroText}>
					<Text variant="display" accessibilityRole="header">
						{t.t("account.rowSignedOut")}
					</Text>
					<Text tone="muted">{t.t("account.sectionHint")}</Text>
				</View>
			</View>
			<SignedOutPanel />
		</Card>
	);
}

const useStyles = makeStyles((t) => ({
	verify: { marginBottom: 20 },
	hero: { marginBottom: 24, gap: 20 },
	heroHead: { gap: 14 },
	heroIcon: {
		width: 48,
		height: 48,
		borderRadius: t.radii.lg,
		alignItems: "center",
		justifyContent: "center",
	},
	heroText: { gap: 6 },
}));
