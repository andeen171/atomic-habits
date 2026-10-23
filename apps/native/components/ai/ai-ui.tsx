import { Sparkles } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { accountController } from "@/lib/account";
import { aiClient } from "@/lib/ai";
import { type AppTranslator, useT } from "@/lib/i18n";
import { syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import type { AiAvailability, Plan, PlanLimits, ServerInfo } from "@atomic/core";
import { useAccountState, useAiAvailability, useSyncState } from "@atomic/core/react";
import { type StyleProp, View, type ViewStyle } from "react-native";

type AiFeature = NonNullable<ServerInfo["features"]["ai"]>;

export interface AiContext {
	availability: AiAvailability;
	/** The server's AI feature (hosting, limits, beta), null without one. */
	feature: AiFeature | null;
	plan: Plan;
	/** The account's own limits (falls back to the server's per-plan table). */
	limits: PlanLimits | null;
	/** Billing is on, so "Get more with Pro" can be offered. */
	billing: boolean;
	/** Pro's daily suggestions, for the upgrade line. */
	proSuggestions: number | null;
	privacyUrl: string | null;
}

/**
 * Everything an AI surface needs: availability (Annex C §1.6 matrix), the
 * server's AI feature and the account's plan and limits. Owner: T5.
 */
export function useAi(): AiContext {
	const availability = useAiAvailability(aiClient);
	const sync = useSyncState(syncController);
	const { account } = useAccountState(accountController);
	const server = sync.server;
	const feature = server?.features.ai ?? null;
	const plan = account?.entitlements.plan ?? "free";
	return {
		availability,
		feature,
		plan,
		limits: account?.entitlements.limits ?? feature?.limits[plan] ?? null,
		billing: Boolean(server?.features.billing),
		proSuggestions: feature?.limits.pro?.aiRequestsPerDay ?? null,
		privacyUrl: server?.legal.privacyUrl ?? null,
	};
}

/** "Where requests are processed" (the consent sheet and the AI settings). */
export function aiWhere(feature: AiFeature | null, t: AppTranslator): string {
	return feature?.hosting === "hosted" && feature.providerName
		? t.t("ai.consentWhere.hosted", { provider: feature.providerName })
		: t.t("ai.consentWhere.self");
}

/** The "Beta" badge every AI surface carries while `features.ai.beta` is on (D31). */
export function AiBadge({ style }: { style?: StyleProp<ViewStyle> }) {
	const t = useT();
	const styles = useStyles();
	return (
		<View style={[styles.badge, style]}>
			<Text variant="label" tone="accent" allowFontScaling={false} style={styles.badgeText}>
				{t.t("ai.beta")}
			</Text>
		</View>
	);
}

/** "✦ AI · Beta": the caption under AI suggestions. */
export function AiCaption({ beta }: { beta: boolean }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View style={styles.caption}>
			<Sparkles size={14} color={colors.accentText} strokeWidth={2} />
			<Text variant="small" tone="muted">
				{beta ? `${t.t("ai.label")} · ${t.t("ai.beta")}` : t.t("ai.label")}
			</Text>
		</View>
	);
}

/** The sparkle in a soft accent tile (sheet headers). */
export function AiTile({ size = 36 }: { size?: number }) {
	const { colors } = useTheme();
	return (
		<View
			style={{
				width: size,
				height: size,
				borderRadius: size * 0.36,
				backgroundColor: colors.accentSoft,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Sparkles size={Math.round(size * 0.5)} color={colors.accentText} strokeWidth={2} />
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	badge: {
		height: 20,
		paddingHorizontal: 8,
		borderRadius: 999,
		backgroundColor: t.colors.accentSoft,
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
	},
	badgeText: { fontSize: 10, lineHeight: 12, letterSpacing: 0.8 },
	caption: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
}));
