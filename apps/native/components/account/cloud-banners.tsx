import { CloudAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { exportBackup } from "@/lib/backup";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { useActions, useAtomic } from "@atomic/core/react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { UpdateBanner } from "./update-banner";

/** Below the screens' 52pt top bar, so back buttons stay reachable. */
const TOP_BAR = 52;

/**
 * App-wide cloud and storage banners, mounted once in `app/_layout.tsx`
 * (spec §5.9, §6): verify email, payment grace, server outdated, clock skew,
 * session ended, `persistError`, `sync.quotaFull`, and the Android update
 * banner. Owner: T5.
 *
 * Phase 1B wires the one that guards data (spec §2.6.5): when a local write
 * fails, a blocking banner asks for a backup until a write succeeds again.
 */
export function CloudBanners() {
	const insets = useSafeAreaInsets();
	const styles = useStyles();
	const persistError = useAtomic((s) => s.persistError);
	return (
		<View
			pointerEvents="box-none"
			style={[styles.layer, { top: insets.top + TOP_BAR + 4 }]}
			testID="cloud-banners"
		>
			{persistError ? <PersistErrorBanner /> : null}
			<UpdateBanner />
		</View>
	);
}

function PersistErrorBanner() {
	const t = useT();
	const { colors, onStatus } = useTheme();
	const styles = useStyles();
	const actions = useActions();
	const onExport = async () => {
		try {
			await exportBackup(actions.exportData(), t.t("settings.export"));
		} catch (error) {
			console.warn("[atomic] Export failed", error);
			showToast(t.t("error.title"), { tone: "danger" });
		}
	};
	return (
		<View
			style={[styles.banner, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}
			accessibilityRole="alert"
			accessibilityLiveRegion="assertive"
			testID="persist-error-banner"
		>
			<View style={[styles.icon, { backgroundColor: colors.danger }]}>
				<CloudAlert size={16} color={onStatus.danger} strokeWidth={2.2} />
			</View>
			<View style={styles.body}>
				<Text variant="small" weight="semibold">
					{t.t("sync.persistError")}
				</Text>
				<Button
					label={t.t("settings.export")}
					variant="ink"
					size="sm"
					onPress={() => void onExport()}
					style={styles.action}
					testID="persist-error-export"
				/>
			</View>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	layer: { position: "absolute", left: 12, right: 12, zIndex: 50, gap: 8 },
	banner: {
		flexDirection: "row",
		gap: 12,
		padding: 14,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		...t.floatShadow,
	},
	icon: {
		width: 30,
		height: 30,
		borderRadius: 15,
		alignItems: "center",
		justifyContent: "center",
	},
	body: { flex: 1, gap: 10 },
	action: { alignSelf: "flex-start" },
}));
