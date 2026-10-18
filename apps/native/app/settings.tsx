import {
	BellRing,
	BookOpen,
	Check,
	Cloud,
	CloudAlert,
	Database,
	Download,
	FlaskConical,
	LogOut,
	RefreshCw,
	Trash2,
	Upload,
} from "@/components/icons";
import { ConfirmSheet } from "@/components/sheet/confirm-sheet";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ListGroup, ListRow, ListSeparator } from "@/components/ui/list-row";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { SectionLabel } from "@/components/ui/section-label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { exportBackup, pickBackup } from "@/lib/backup";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { reminderHabits, useNotificationPermission } from "@/lib/reminders";
import { defaultServerUrl, syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	LOCALE_SETTINGS,
	type LocaleSetting,
	type MessageKey,
	type ThemeSetting,
	capitalize,
} from "@atomic/core";
import { useActions, useAtomic, useSettings, useSyncState } from "@atomic/core/react";
import Constants from "expo-constants";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";

const isNative = Platform.OS !== "web";

export default function SettingsScreen() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const actions = useActions();
	const settings = useSettings();
	const [name, setName] = useState(settings.displayName);
	const { permission, request: requestNotifications } = useNotificationPermission();
	const reminderCount = useAtomic((s) => reminderHabits(s.data.habits).length);
	const [confirm, setConfirm] = useState<"demo" | "reset" | null>(null);
	const [lawsOpen, setLawsOpen] = useState(false);
	const version = Constants.expoConfig?.version ?? "1.0.0";

	const onReminders = async (value: boolean) => {
		if (value && isNative && !(await requestNotifications())) {
			// Never show reminders as on when the system will not deliver them.
			actions.updateSettings({ remindersEnabled: false });
			showToast(t.t("settings.remindersDenied"), { tone: "danger" });
			return;
		}
		actions.updateSettings({ remindersEnabled: value });
	};
	const blocked = Boolean(permission && !permission.granted && !permission.canAskAgain);
	// Reminders are on (and some habit has one) but the system won't deliver them.
	const needsPermission =
		isNative && settings.remindersEnabled && reminderCount > 0 && permission?.granted === false;

	const onExport = async () => {
		try {
			await exportBackup(actions.exportData(), t.t("settings.export"));
			showToast(t.x("settings.exported"), { tone: "success" });
		} catch (error) {
			console.warn("[atomic] Export failed", error);
			showToast(t.t("error.title"), { tone: "danger" });
		}
	};

	const onImport = async () => {
		let data: unknown;
		try {
			data = await pickBackup();
		} catch {
			showToast(t.t("settings.importError"), { tone: "danger" });
			return;
		}
		if (data === null) return;
		const result = actions.importData(data, "merge");
		if (result.ok) {
			haptics.success();
			showToast(t.tp("settings.importSuccess", result.imported), { tone: "success" });
		} else {
			haptics.warning();
			showToast(t.t("settings.importError"), { tone: "danger" });
		}
	};

	return (
		<Screen back title={t.t("settings.title")} keyboard testID="settings-screen">
			<ScreenTitle title={t.t("settings.title")} />

			<SectionLabel>{t.t("settings.profile")}</SectionLabel>
			<Card padding={16} style={styles.block}>
				<TextField
					label={t.t("settings.name")}
					value={name}
					onChangeText={setName}
					onBlur={() => actions.updateSettings({ displayName: name.trim() })}
					onSubmitEditing={() => actions.updateSettings({ displayName: name.trim() })}
					placeholder={t.t("settings.namePlaceholder")}
					maxLength={60}
					returnKeyType="done"
					testID="settings-name"
				/>
			</Card>

			<SectionLabel>{t.t("settings.appearance")}</SectionLabel>
			<Card padding={16} style={[styles.block, styles.stack]}>
				<View style={styles.field}>
					<Text variant="small" weight="semibold">
						{t.t("settings.theme")}
					</Text>
					<SegmentedControl<ThemeSetting>
						value={settings.theme}
						onChange={(theme) => actions.updateSettings({ theme })}
						segments={[
							{ value: "system", label: t.t("settings.theme.system") },
							{ value: "light", label: t.t("settings.theme.light") },
							{ value: "dark", label: t.t("settings.theme.dark") },
						]}
						accessibilityLabel={t.t("settings.theme")}
					/>
				</View>
				<View style={styles.field}>
					<Text variant="small" weight="semibold">
						{t.t("settings.language")}
					</Text>
					<View style={styles.options} accessibilityRole="radiogroup">
						{LOCALE_SETTINGS.map((locale: LocaleSetting) => {
							const selected = settings.locale === locale;
							return (
								<Pressable
									key={locale}
									onPress={() => {
										haptics.selection();
										actions.updateSettings({ locale });
									}}
									accessibilityRole="radio"
									accessibilityState={{ selected }}
									style={[
										styles.option,
										selected && { borderColor: colors.text, backgroundColor: colors.surface },
									]}
									testID={`locale-${locale}`}
								>
									<Text weight={selected ? "semibold" : "regular"} style={{ flex: 1 }}>
										{t.t(`settings.language.${locale}` as MessageKey)}
									</Text>
									{selected ? <Check size={18} color={colors.text} strokeWidth={2.4} /> : null}
								</Pressable>
							);
						})}
					</View>
				</View>
			</Card>

			<SectionLabel>{t.t("settings.preferences")}</SectionLabel>
			<ListGroup style={styles.block}>
				<View style={styles.prefRow}>
					<Text weight="medium" style={{ flex: 1 }}>
						{t.t("settings.weekStartsOn")}
					</Text>
					<SegmentedControl<0 | 1>
						value={settings.weekStartsOn}
						onChange={(weekStartsOn) => actions.updateSettings({ weekStartsOn })}
						size="sm"
						segments={[
							{ value: 1, label: capitalize(t.weekdayName(1, "short")) },
							{ value: 0, label: capitalize(t.weekdayName(0, "short")) },
						]}
						style={{ width: 140 }}
						accessibilityLabel={t.t("settings.weekStartsOn")}
					/>
				</View>
				<ListSeparator inset={16} />
				<ListRow
					title={t.t("settings.celebrations")}
					subtitle={t.t("settings.celebrationsHint")}
					right={
						<Switch
							value={settings.celebrations}
							onValueChange={(celebrations) => actions.updateSettings({ celebrations })}
							accessibilityLabel={t.t("settings.celebrations")}
						/>
					}
				/>
				{isNative ? (
					<>
						<ListSeparator inset={16} />
						<ListRow
							title={t.t("settings.haptics")}
							right={
								<Switch
									value={settings.hapticsEnabled}
									onValueChange={(hapticsEnabled) => actions.updateSettings({ hapticsEnabled })}
									accessibilityLabel={t.t("settings.haptics")}
								/>
							}
						/>
						<ListSeparator inset={16} />
						<ListRow
							title={t.t("settings.reminders")}
							subtitle={
								settings.remindersEnabled && blocked
									? t.t("settings.remindersDenied")
									: t.t("settings.remindersHint")
							}
							right={
								<Switch
									value={settings.remindersEnabled}
									onValueChange={(value) => void onReminders(value)}
									accessibilityLabel={t.t("settings.reminders")}
								/>
							}
						/>
						{needsPermission ? (
							<>
								<ListSeparator inset={16} />
								<ListRow
									icon={BellRing}
									iconColor={colors.warning}
									iconBg={colors.warningSoft}
									title={t.x("settings.remindersEnable")}
									subtitle={t.x(
										reminderCount === 1
											? "settings.remindersWaitingOne"
											: "settings.remindersWaitingOther",
										{ count: t.number(reminderCount) },
									)}
									chevron
									onPress={() => void requestNotifications()}
									testID="settings-allow-notifications"
								/>
							</>
						) : null}
					</>
				) : null}
			</ListGroup>

			<SyncSection />

			<SectionLabel>{t.t("settings.data")}</SectionLabel>
			<Text variant="small" tone="muted" style={styles.note}>
				{t.t("settings.dataHint")}
			</Text>
			<ListGroup style={styles.block}>
				<ListRow
					icon={Download}
					title={t.t("settings.export")}
					chevron
					onPress={() => void onExport()}
					testID="settings-export"
				/>
				<ListSeparator />
				<ListRow
					icon={Upload}
					title={t.t("settings.import")}
					chevron
					onPress={() => void onImport()}
					testID="settings-import"
				/>
				<ListSeparator />
				<ListRow
					icon={FlaskConical}
					title={t.t("settings.demo")}
					subtitle={t.t("settings.demoHint")}
					chevron
					onPress={() => setConfirm("demo")}
					testID="settings-demo"
				/>
				<ListSeparator />
				<ListRow
					icon={Trash2}
					title={t.t("settings.reset")}
					subtitle={t.t("settings.resetHint")}
					destructive
					iconBg={colors.dangerSoft}
					onPress={() => setConfirm("reset")}
					testID="settings-reset"
				/>
			</ListGroup>

			<SectionLabel>{t.t("settings.about")}</SectionLabel>
			<ListGroup style={styles.block}>
				<ListRow
					icon={BookOpen}
					title={t.t("form.advanced")}
					chevron
					onPress={() => setLawsOpen(true)}
				/>
				<ListSeparator />
				<ListRow
					icon={Database}
					title={t.t("app.name")}
					value={t.t("settings.version", { version })}
				/>
			</ListGroup>
			<Text variant="tiny" tone="subtle" align="center" style={{ paddingHorizontal: 20 }}>
				{`${t.x("settings.privacy")} ${t.t("app.attribution")}`}
			</Text>

			<ConfirmSheet
				open={confirm === "demo"}
				title={t.t("settings.demo")}
				body={t.t("settings.demoConfirm")}
				confirmLabel={t.t("settings.demo")}
				onClose={() => setConfirm(null)}
				onConfirm={() => {
					actions.loadDemoData(t.locale);
					haptics.success();
				}}
			/>
			<ConfirmSheet
				open={confirm === "reset"}
				title={t.t("settings.reset")}
				body={t.t("settings.resetConfirm")}
				confirmLabel={t.t("settings.reset")}
				destructive
				onClose={() => setConfirm(null)}
				onConfirm={() => {
					void syncController.signOut().catch(() => {});
					actions.resetAll();
					haptics.warning();
				}}
			/>
			<LawsSheet open={lawsOpen} onClose={() => setLawsOpen(false)} />
		</Screen>
	);
}

function SyncSection() {
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

/** The four laws of behavior change (and their inversions). */
function LawsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const t = useT();
	const { colors } = useTheme();
	const laws = [1, 2, 3, 4] as const;
	return (
		<Sheet
			open={open}
			onClose={onClose}
			title={t.t("form.advanced")}
			subtitle={t.t("form.advancedHint")}
		>
			<View style={{ gap: 14 }}>
				{laws.map((law) => (
					<View key={law} style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
						<View
							style={{
								width: 36,
								height: 36,
								borderRadius: 12,
								backgroundColor: colors.accentSoft,
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<Text weight="bold" tone="accent">
								{law}
							</Text>
						</View>
						<View style={{ flex: 1, gap: 1 }}>
							<Text variant="label">{t.t(`law.${law}.stage`)}</Text>
							<Text weight="semibold">{t.t(`law.${law}.name`)}</Text>
							<Text variant="small" tone="muted">
								{t.t(`law.${law}.inverse`)}
							</Text>
						</View>
					</View>
				))}
			</View>
		</Sheet>
	);
}

const useStyles = makeStyles((t) => ({
	block: { marginBottom: 24 },
	stack: { gap: 14 },
	field: { gap: 8 },
	options: { gap: 8 },
	option: {
		flexDirection: "row",
		alignItems: "center",
		minHeight: 48,
		paddingHorizontal: 14,
		borderRadius: t.radii.md,
		borderWidth: 1.5,
		borderColor: t.colors.border,
		backgroundColor: t.colors.bg,
	},
	prefRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		minHeight: 60,
		paddingHorizontal: 16,
	},
	note: { marginBottom: 10, marginTop: -4 },
	beta: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
	syncHead: { flexDirection: "row", alignItems: "center", gap: 10 },
	row: { flexDirection: "row", gap: 10, alignItems: "center" },
}));
