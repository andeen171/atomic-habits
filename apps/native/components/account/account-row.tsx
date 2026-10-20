import { UserRound } from "@/components/icons";
import { ListGroup, ListRow } from "@/components/ui/list-row";
import { useT } from "@/lib/i18n";
import { syncController } from "@/lib/sync";
import { useTheme } from "@/lib/theme";
import { useSyncState } from "@atomic/core/react";
import { router } from "expo-router";
import type { StyleProp, ViewStyle } from "react-native";

/**
 * The account entry at the top of the You hub (Annex C §5): signed in, the
 * email and plan; signed out, "Back up & sync". Opens `/account`. Renders
 * its own `ListGroup`; the host passes the spacing. Owner: T5. Phase 1B: a
 * plain row with the v1 sync strings.
 */
export function AccountRow({ style }: { style?: StyleProp<ViewStyle> }) {
	const t = useT();
	const { colors } = useTheme();
	const sync = useSyncState(syncController);
	const email = sync.status !== "signed-out" ? sync.user?.email : undefined;
	return (
		<ListGroup style={style}>
			<ListRow
				icon={UserRound}
				iconColor={colors.accentText}
				iconBg={colors.accentSoft}
				title={t.t("nav.account")}
				subtitle={email ? t.t("settings.signedInAs", { email }) : t.t("settings.syncHint")}
				chevron
				onPress={() => router.push("/account")}
				testID="link-account"
			/>
		</ListGroup>
	);
}
