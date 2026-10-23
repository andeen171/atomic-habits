import { ChevronRight, CloudUpload } from "@/components/icons";
import { ListGroup } from "@/components/ui/list-row";
import { Text } from "@/components/ui/text";
import { accountController } from "@/lib/account";
import { useT } from "@/lib/i18n";
import { syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import { useAccountState, useSyncState } from "@atomic/core/react";
import { router } from "expo-router";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import { Avatar, PlanBadge } from "./account-ui";

/**
 * The account entry at the top of the You hub (Annex C §5): signed in, the
 * avatar, name, email and plan; signed out, "Back up & sync". Opens
 * `/account`. Renders its own `ListGroup`; the host passes the spacing.
 * Owner: T5.
 */
export function AccountRow({ style }: { style?: StyleProp<ViewStyle> }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const sync = useSyncState(syncController);
	const { account } = useAccountState(accountController);
	const user = sync.user;
	const name = account?.name || user?.name || "";
	const title = user ? name || user.email : t.t("account.rowSignedOut");
	const subtitle = user ? user.email : t.t("account.rowSignedOutHint");
	const plan = user && account ? account.entitlements.plan : null;
	return (
		<ListGroup style={style}>
			<Pressable
				onPress={() => router.push("/account")}
				accessibilityRole="button"
				accessibilityLabel={[
					user ? `${t.t("nav.account")}: ${title}` : title,
					user && name ? user.email : user ? null : subtitle,
					plan ? (plan === "pro" ? t.t("plan.pro") : t.t("plan.free")) : null,
				]
					.filter(Boolean)
					.join(", ")}
				style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.hover }]}
				testID="link-account"
			>
				{user ? (
					<Avatar name={name} email={user.email} size={42} />
				) : (
					<View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
						<CloudUpload size={20} color={colors.accentText} strokeWidth={2} />
					</View>
				)}
				<View style={styles.text}>
					<View style={styles.titleRow}>
						<Text weight="semibold" numberOfLines={1} style={styles.title}>
							{title}
						</Text>
						{plan ? <PlanBadge plan={plan} /> : null}
					</View>
					<Text variant="small" tone="muted" numberOfLines={1}>
						{subtitle}
					</Text>
				</View>
				<ChevronRight size={18} color={colors.textSubtle} />
			</Pressable>
		</ListGroup>
	);
}

const useStyles = makeStyles(() => ({
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		minHeight: 68,
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	icon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
	text: { flex: 1, gap: 1 },
	titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
	title: { flexShrink: 1 },
}));
