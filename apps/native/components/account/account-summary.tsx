import { Cloud, CloudAlert, LogOut, RefreshCw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { defaultServerUrl, syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import { useAtomic, useSyncState } from "@atomic/core/react";
import { useState } from "react";
import { Pressable, View } from "react-native";

/**
 * The account and sync summary on Settings (Annex C §5: the same states as
 * the web account section, inside a `Card`). Owner: T5. Phase 1B: the v1
 * inline `SyncSection` of `app/settings.tsx`, moved here verbatim.
 */
export function AccountSummary() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const sync = useSyncState(syncController);
	const savedUrl = useAtomic((s) => s.settings.serverUrl);
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<"in" | "up">("in");
	const [url, setUrl] = useState(savedUrl ?? defaultServerUrl);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const signedIn = sync.status !== "signed-out" && sync.user;

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			if (mode === "in") await syncController.signIn(url, email, password);
			else await syncController.signUp(url, displayName, email, password);
			setPassword("");
			haptics.success();
		} catch {
			setError(
				syncController.getState().error === "auth"
					? t.t("settings.authError")
					: t.t("settings.syncError"),
			);
			haptics.warning();
		} finally {
			setBusy(false);
		}
	};

	const status =
		sync.status === "syncing"
			? t.t("settings.syncing")
			: sync.status === "error"
				? t.t("settings.syncError")
				: sync.lastSyncedAt
					? t.t("settings.lastSynced", { time: t.formatAgo(sync.lastSyncedAt) })
					: t.t("settings.neverSynced");

	return (
		<>
			<SectionLabel
				right={
					<View style={[styles.beta, { backgroundColor: colors.accentSoft }]}>
						<Text variant="tiny" weight="bold" tone="accent">
							{t.t("settings.syncBeta")}
						</Text>
					</View>
				}
			>
				{t.t("settings.sync")}
			</SectionLabel>
			<Card padding={16} style={[styles.block, styles.stack]}>
				<View style={styles.syncHead}>
					{sync.status === "error" ? (
						<CloudAlert size={20} color={colors.danger} />
					) : (
						<Cloud size={20} color={signedIn ? colors.success : colors.textSubtle} />
					)}
					<Text variant="small" tone="muted" style={{ flex: 1 }}>
						{signedIn
							? t.t("settings.signedInAs", { email: sync.user?.email ?? "" })
							: t.t("settings.syncHint")}
					</Text>
				</View>
				{signedIn ? (
					<>
						<Text
							variant="small"
							weight="medium"
							tone={sync.status === "error" ? "danger" : "subtle"}
						>
							{status}
						</Text>
						<View style={styles.row}>
							<Button
								label={
									sync.status === "syncing" ? t.t("settings.syncing") : t.t("settings.syncNow")
								}
								icon={RefreshCw}
								variant="secondary"
								size="sm"
								loading={sync.status === "syncing"}
								onPress={() => void syncController.syncNow()}
								style={{ flex: 1 }}
							/>
							<Button
								label={t.t("settings.signOut")}
								icon={LogOut}
								variant="ghost"
								size="sm"
								onPress={() => void syncController.signOut().catch(() => {})}
							/>
						</View>
					</>
				) : open ? (
					<View style={styles.stack}>
						<SegmentedControl<"in" | "up">
							value={mode}
							onChange={setMode}
							segments={[
								{ value: "in", label: t.t("settings.signIn") },
								{ value: "up", label: t.t("settings.signUp") },
							]}
						/>
						<TextField
							label={t.t("settings.serverUrl")}
							value={url}
							onChangeText={setUrl}
							placeholder={t.t("settings.serverUrlPlaceholder")}
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="url"
						/>
						{mode === "up" ? (
							<TextField
								label={t.t("settings.displayName")}
								value={displayName}
								onChangeText={setDisplayName}
								autoComplete="name"
							/>
						) : null}
						<TextField
							label={t.t("settings.email")}
							value={email}
							onChangeText={setEmail}
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="email-address"
							autoComplete="email"
							textContentType="emailAddress"
						/>
						<TextField
							label={t.t("settings.password")}
							value={password}
							onChangeText={setPassword}
							secureTextEntry
							autoComplete={mode === "up" ? "new-password" : "current-password"}
							textContentType={mode === "up" ? "newPassword" : "password"}
							error={error}
						/>
						<Button
							label={mode === "in" ? t.t("settings.signIn") : t.t("settings.signUp")}
							size="lg"
							loading={busy}
							disabled={!url.trim() || !email.trim() || password.length < 8}
							onPress={() => void submit()}
						/>
						<Pressable
							onPress={() => setMode(mode === "in" ? "up" : "in")}
							hitSlop={8}
							style={{ alignSelf: "center" }}
						>
							<Text variant="small" tone="muted">
								{mode === "in" ? t.t("settings.noAccount") : t.t("settings.haveAccount")}{" "}
								<Text variant="small" weight="semibold" tone="accent">
									{mode === "in" ? t.t("settings.signUp") : t.t("settings.signIn")}
								</Text>
							</Text>
						</Pressable>
					</View>
				) : (
					<Button
						label={t.x("settings.syncSetup")}
						variant="secondary"
						icon={Cloud}
						onPress={() => setOpen(true)}
					/>
				)}
			</Card>
		</>
	);
}

const useStyles = makeStyles(() => ({
	block: { marginBottom: 24 },
	stack: { gap: 14 },
	beta: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
	syncHead: { flexDirection: "row", alignItems: "center", gap: 10 },
	row: { flexDirection: "row", gap: 10, alignItems: "center" },
}));
