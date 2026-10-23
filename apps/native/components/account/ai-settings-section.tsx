import { CloudOff, MailWarning, ShieldCheck } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { accountController } from "@/lib/account";
import { useAiConsent } from "@/lib/ai";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { accountErrorKey } from "@atomic/core";
import { useAccountState, useLocale } from "@atomic/core/react";
import { useState } from "react";
import { View } from "react-native";
import { PrivacyLink } from "../ai/ai-consent-sheet";
import { AiBadge, aiWhere, useAi } from "../ai/ai-ui";
import { Divider, Notice, Spinner } from "./account-ui";
import { formatClock } from "./format";

/**
 * Settings → AI assistant (Beta) (Annex C §1.6, §1.8 and §5; D31–D32), also
 * on the Account screen after the plan:
 * - "AI suggestions": on opens the consent sheet; off withdraws consent on
 *   the account (every device) and removes translations;
 * - "Translate my content to the app language" (default off), only when the
 *   server translates; off removes every translation;
 * - today's use against the plan's limit, where requests are processed and
 *   that nothing is stored, with the privacy policy;
 * - unverified email and offline notices (resending sits in the verify
 *   notice of the account card or the Account screen).
 * Nothing without an account or on servers without AI. Owner: T5.
 */
export function AiSettingsSection() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const locale = useLocale();
	const ai = useAi();
	const { account } = useAccountState(accountController);
	const ask = useAiConsent((s) => s.ask);
	const [busy, setBusy] = useState<"suggest" | "translate" | null>(null);
	const { availability, feature, limits, privacyUrl } = ai;
	if (availability.status === "hidden" || !feature || !account) return null;

	const consented = account.ai.consentAt != null;
	const offline = availability.status === "offline";
	const unverified = availability.status === "unverified";
	const usage = account.usage;

	const suggestQuota = availability.quota.suggest;
	const suggestLimit = suggestQuota?.limit ?? limits?.aiRequestsPerDay ?? null;
	const suggestUsed = suggestQuota
		? suggestQuota.limit - suggestQuota.remaining
		: usage.aiRequestsToday;
	const translateQuota = availability.quota.translate;
	const translateLimit = translateQuota?.limit ?? limits?.aiTranslateCharsPerDay ?? null;
	const translateUsed = translateQuota
		? translateQuota.limit - translateQuota.remaining
		: usage.aiTranslateCharsToday;
	const resets = formatClock(suggestQuota?.resetsAt ?? usage.aiResetsAt, locale);

	const save = async (
		which: "suggest" | "translate",
		input: { suggestions: boolean; translate: boolean },
		done: string,
	) => {
		if (busy) return;
		setBusy(which);
		try {
			await accountController.setAiConsent(input);
			haptics.success();
			showToast(done, { tone: "success" });
		} catch (error) {
			haptics.warning();
			showToast(t.t(accountErrorKey(error)), { tone: "danger" });
		} finally {
			setBusy(null);
		}
	};

	const onSuggestChange = (on: boolean) => {
		if (on) ask();
		else void save("suggest", { suggestions: false, translate: false }, t.t("ai.turnedOff"));
	};
	const onTranslateChange = (on: boolean) =>
		void save(
			"translate",
			{ suggestions: true, translate: on },
			on ? t.t("ai.translateStarted") : t.t("ai.translateCleared"),
		);

	const suggestUsage =
		consented && suggestLimit !== null && feature.suggest
			? `${t.t("ai.usageSuggest", { used: t.number(Math.max(0, suggestUsed)), limit: t.number(suggestLimit) })} · ${t.t("plan.usage.resets", { time: resets })}`
			: null;
	const translateUsage =
		consented && availability.translateOn && translateLimit !== null
			? t.t("ai.usageTranslate", {
					used: t.number(Math.max(0, translateUsed)),
					limit: t.number(translateLimit),
				})
			: null;

	return (
		<>
			<View style={styles.label}>
				<Text variant="label" tone="subtle" accessibilityRole="header">
					{t.t("ai.title")}
				</Text>
				{availability.beta ? <AiBadge /> : null}
			</View>
			<Card padding={0} style={styles.block} testID="ai-settings">
				{unverified ? (
					// "Resend email" is in the verify notice of the account card
					// (Settings) or at the top of the Account screen.
					<Notice tone="info" icon={MailWarning} style={styles.notice}>
						{t.t("ai.error.unverified")}
					</Notice>
				) : offline ? (
					<Notice tone="info" icon={CloudOff} style={styles.notice}>
						{t.t("ai.error.offline")}
					</Notice>
				) : null}
				<SwitchRow
					title={t.t("ai.suggestToggle")}
					hint={t.t("ai.suggestHint")}
					usage={suggestUsage}
					value={consented}
					busy={busy === "suggest"}
					disabled={offline || busy !== null || (unverified && !consented)}
					onChange={onSuggestChange}
					testID="ai-settings-suggest"
				/>
				{feature.translate ? (
					<>
						<Divider />
						<SwitchRow
							title={t.t("ai.translateToggle")}
							hint={t.t("ai.translateHint")}
							usage={translateUsage}
							value={consented && availability.translateOn}
							busy={busy === "translate"}
							disabled={!consented || offline || unverified || busy !== null}
							onChange={onTranslateChange}
							testID="ai-settings-translate"
						/>
					</>
				) : null}
				<Divider />
				<View style={styles.privacy}>
					<ShieldCheck
						size={16}
						color={colors.textMuted}
						strokeWidth={2}
						style={styles.privacyIcon}
					/>
					<View style={styles.privacyText}>
						<Text variant="small" tone="muted">
							{`${aiWhere(feature, t)} ${t.t("ai.consentStore")}`}
						</Text>
						{privacyUrl ? <PrivacyLink url={privacyUrl} small /> : null}
					</View>
				</View>
			</Card>
		</>
	);
}

function SwitchRow({
	title,
	hint,
	usage,
	value,
	busy,
	disabled,
	onChange,
	testID,
}: {
	title: string;
	hint: string;
	usage: string | null;
	value: boolean;
	busy: boolean;
	disabled: boolean;
	onChange(value: boolean): void;
	testID?: string;
}) {
	const styles = useStyles();
	return (
		<View style={styles.row}>
			<View style={styles.text}>
				<Text weight="medium">{title}</Text>
				<Text variant="small" tone="muted">
					{hint}
				</Text>
				{usage ? (
					<Text variant="small" tabular style={styles.usage}>
						{usage}
					</Text>
				) : null}
			</View>
			<View style={styles.control}>
				{busy ? <Spinner /> : null}
				<Switch
					value={value}
					onValueChange={onChange}
					disabled={disabled}
					accessibilityLabel={title}
					testID={testID}
				/>
			</View>
		</View>
	);
}

const useStyles = makeStyles(() => ({
	label: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		marginBottom: 10,
		minHeight: 20,
	},
	block: { marginBottom: 24 },
	notice: { marginHorizontal: 12, marginTop: 12, marginBottom: 2 },
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		paddingHorizontal: 16,
		paddingVertical: 14,
		minHeight: 60,
	},
	text: { flex: 1, gap: 2 },
	usage: { marginTop: 4 },
	control: { flexDirection: "row", alignItems: "center", gap: 8 },
	privacy: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 16 },
	privacyIcon: { marginTop: 1 },
	privacyText: { flex: 1, gap: 6 },
}));
