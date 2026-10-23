import { Gauge, type LucideIcon, Send, Server, ShieldCheck, Sparkles } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { accountController } from "@/lib/account";
import { useAiConsent } from "@/lib/ai";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { openExternal } from "@/lib/open-external";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { accountErrorKey } from "@atomic/core";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { InlineError } from "../account/account-ui";
import { AiBadge, AiTile, aiWhere, useAi } from "./ai-ui";

/**
 * "Turn on AI suggestions?" (Annex C §1.6, LGPD art. 8): what is sent, where
 * it is processed, that nothing is stored or used for training, the daily
 * limit and that AI can be wrong, plus the separate, default-off "Translate
 * my content" switch and the privacy policy. Consent is stored on the
 * account (`ai.setConsent`), so the user's other devices inherit it. Opened
 * through `useAiConsent().ask()`; mounted once, in `CloudBanners`. Owner: T5.
 */
export function AiConsentSheet() {
	const open = useAiConsent((s) => s.open);
	const close = useAiConsent((s) => s.close);
	const [session, setSession] = useState(0);
	useEffect(() => {
		if (open) setSession((value) => value + 1);
	}, [open]);
	return (
		<Sheet open={open} onClose={() => close(false)} scroll testID="ai-consent-sheet">
			{session > 0 ? <ConsentBody key={session} open={open} onDone={close} /> : null}
		</Sheet>
	);
}

function ConsentBody({ open, onDone }: { open: boolean; onDone(granted: boolean): void }) {
	const t = useT();
	const styles = useStyles();
	const { availability, feature, plan, limits, billing, privacyUrl } = useAi();
	const [translate, setTranslate] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const beta = availability.beta || feature?.beta !== false;

	// The account changed under the sheet (signed out, AI switched off): nothing to consent to.
	useEffect(() => {
		if (open && !feature) onDone(false);
	}, [open, feature, onDone]);

	const perDay = limits?.aiRequestsPerDay ?? null;
	const limitLine =
		perDay === null
			? null
			: billing && plan === "free"
				? t.t("ai.consentLimits", { count: t.number(perDay) })
				: t.t("ai.consentLimitsYours", { count: t.number(perDay) });

	const turnOn = async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const consent = await accountController.setAiConsent({
				suggestions: true,
				translate: Boolean(feature?.translate) && translate,
			});
			haptics.success();
			showToast(
				consent.translate
					? `${t.t("ai.turnedOn")}. ${t.t("ai.translateStarted")}`
					: t.t("ai.turnedOn"),
				{ tone: "success", duration: consent.translate ? 5000 : undefined },
			);
			onDone(true);
		} catch (failure) {
			haptics.warning();
			setError(t.t(accountErrorKey(failure)));
		} finally {
			setBusy(false);
		}
	};

	return (
		<View style={styles.body}>
			<View style={styles.header}>
				<AiTile size={40} />
				<Text variant="h2" accessibilityRole="header" style={styles.title}>
					{t.t("ai.consentTitle")}
				</Text>
				{beta ? <AiBadge /> : null}
			</View>
			<View style={styles.points}>
				<Point icon={Send}>{t.t("ai.consentWhat")}</Point>
				<Point icon={Server}>{aiWhere(feature, t)}</Point>
				<Point icon={ShieldCheck}>{t.t("ai.consentStore")}</Point>
				{limitLine ? <Point icon={Gauge}>{limitLine}</Point> : null}
				<Point icon={Sparkles}>{t.t("ai.consentBeta")}</Point>
			</View>
			{feature?.translate ? (
				<View style={styles.translate}>
					<View style={styles.translateText}>
						<Text weight="medium">{t.t("ai.translateToggle")}</Text>
						<Text variant="small" tone="muted">
							{t.t("ai.translateHint")}
						</Text>
					</View>
					<Switch
						value={translate}
						onValueChange={setTranslate}
						accessibilityLabel={t.t("ai.translateToggle")}
						testID="ai-consent-translate"
					/>
				</View>
			) : null}
			{privacyUrl ? <PrivacyLink url={privacyUrl} /> : null}
			{error ? <InlineError>{error}</InlineError> : null}
			<View style={styles.actions}>
				<Button
					label={t.t("ai.notNow")}
					variant="secondary"
					size="lg"
					onPress={() => onDone(false)}
					style={styles.action}
					testID="ai-consent-not-now"
				/>
				<Button
					label={t.t("ai.turnOn")}
					icon={Sparkles}
					size="lg"
					loading={busy}
					onPress={() => void turnOn()}
					style={styles.action}
					testID="ai-consent-turn-on"
				/>
			</View>
		</View>
	);
}

function Point({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View style={styles.point}>
			<View style={styles.pointIcon} accessibilityElementsHidden importantForAccessibility="no">
				<Icon size={15} color={colors.accentText} strokeWidth={2.2} />
			</View>
			<Text style={styles.pointText}>{children}</Text>
		</View>
	);
}

/** "Privacy policy", opened in the in-app browser. */
export function PrivacyLink({ url, small }: { url: string; small?: boolean }) {
	const t = useT();
	const { colors } = useTheme();
	return (
		<Pressable
			onPress={() => void openExternal(url)}
			accessibilityRole="link"
			hitSlop={10}
			style={({ pressed }) => ({ alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}
		>
			<Text
				variant={small ? "small" : "body"}
				weight="medium"
				color={colors.accentText}
				style={{ textDecorationLine: "underline", textDecorationColor: colors.accentText }}
			>
				{t.t("ai.privacy")}
			</Text>
		</Pressable>
	);
}

const useStyles = makeStyles((t) => ({
	body: { gap: 20, paddingTop: 2 },
	header: { flexDirection: "row", alignItems: "center", gap: 12 },
	title: { flex: 1 },
	points: { gap: 14 },
	point: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
	pointIcon: {
		width: 30,
		height: 30,
		borderRadius: 15,
		backgroundColor: t.colors.accentSoft,
		alignItems: "center",
		justifyContent: "center",
	},
	pointText: { flex: 1, paddingTop: 4 },
	translate: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		padding: 14,
		borderRadius: t.radii.lg,
		backgroundColor: t.colors.sunken,
	},
	translateText: { flex: 1, gap: 2 },
	actions: { flexDirection: "row", gap: 10, marginTop: 4 },
	action: { flex: 1 },
}));
