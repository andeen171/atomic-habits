import { BadgeCheck, CircleAlert } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { accountController } from "@/lib/account";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { accountErrorKey } from "@atomic/core";
import { useAccountState, useSyncState } from "@atomic/core/react";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Avatar, Divider } from "./account-ui";
import { formatDate } from "./format";

/**
 * Account → Profile (Annex C §1.1, §5): the account name, edited in place
 * (saved when the field loses focus or on Done), the email with its
 * verified state, sign-in methods and the account's age. The account name
 * is separate from the name this device greets you with. Owner: T5.
 */
export function ProfileSection() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const sync = useSyncState(syncController);
	const { account, server } = useAccountState(accountController);
	const user = sync.user;
	const savedName = account?.name ?? user?.name ?? "";
	const [name, setName] = useState(savedName);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const editing = useRef(false);

	useEffect(() => {
		if (!editing.current) setName(savedName);
	}, [savedName]);

	if (!user) return null;
	const email = account?.email ?? user.email;
	const verified = account?.emailVerified ?? user.emailVerified ?? null;

	const save = async () => {
		if (saving) return;
		editing.current = false;
		const next = name.trim();
		if (!next || next === savedName) {
			setName(savedName);
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await accountController.updateName(next);
			haptics.success();
			showToast(t.t("common.saved"), { tone: "success" });
		} catch (caught) {
			haptics.warning();
			setError(t.t(accountErrorKey(caught)));
		} finally {
			setSaving(false);
		}
	};

	const providers = account?.providers ?? [];
	const methods = [
		...(account?.hasPassword ? [t.t("account.providerPassword")] : []),
		...(providers.includes("google") ? [t.t("account.providerGoogle")] : []),
	];

	return (
		<>
			<SectionLabel>{t.t("settings.profile")}</SectionLabel>
			<Card padding={0} style={styles.block} testID="profile-section">
				<View style={styles.top}>
					<Avatar name={name || savedName} email={email} size={56} />
					<View style={{ flex: 1 }}>
						<TextField
							label={t.t("settings.displayName")}
							value={name}
							onChangeText={(value) => {
								editing.current = true;
								setName(value);
							}}
							// Done blurs the field, which saves (once).
							onBlur={() => void save()}
							returnKeyType="done"
							maxLength={80}
							autoComplete="name"
							textContentType="name"
							error={error}
							hint={t.t("account.nameHint")}
							right={saving ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
							testID="profile-name"
						/>
					</View>
				</View>
				<Divider />
				<View style={styles.facts}>
					<View style={styles.fact}>
						<Text variant="small" tone="muted">
							{t.t("settings.email")}
						</Text>
						<View style={styles.emailRow}>
							<Text weight="medium" style={styles.email} selectable>
								{email}
							</Text>
							{verified === true ? (
								<Pill tone="success" icon="check" label={t.t("account.verified")} />
							) : verified === false && server?.features.email ? (
								<Pill tone="warning" icon="alert" label={t.t("account.unverified")} />
							) : null}
						</View>
					</View>
					{methods.length ? (
						<View style={styles.fact}>
							<Text variant="small" tone="muted">
								{t.t("account.signInWith")}
							</Text>
							<Text weight="medium">{t.formatList(methods)}</Text>
						</View>
					) : null}
					{account ? (
						<Text variant="small" tone="muted">
							{t.t("account.memberSince", { date: formatDate(account.createdAt, t, 0) })}
						</Text>
					) : null}
				</View>
			</Card>
		</>
	);
}

function Pill({
	tone,
	icon,
	label,
}: {
	tone: "success" | "warning";
	icon: "check" | "alert";
	label: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	const Icon = icon === "check" ? BadgeCheck : CircleAlert;
	return (
		<View
			style={[
				styles.pill,
				{ backgroundColor: tone === "success" ? colors.successSoft : colors.warningSoft },
			]}
		>
			<Icon
				size={13}
				color={tone === "success" ? colors.success : colors.warning}
				strokeWidth={2.4}
			/>
			<Text variant="tiny" weight="semibold">
				{label}
			</Text>
		</View>
	);
}

const useStyles = makeStyles(() => ({
	block: { marginBottom: 24 },
	top: { flexDirection: "row", alignItems: "flex-start", gap: 14, padding: 16 },
	facts: { padding: 16, gap: 14 },
	fact: { gap: 3 },
	emailRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
	email: { flexShrink: 1 },
	pill: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
		paddingHorizontal: 8,
		paddingVertical: 3,
		borderRadius: 999,
	},
}));
