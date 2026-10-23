import { accountController } from "@/lib/account";
import { useAiConsent } from "@/lib/ai";
import { isTauri } from "@/lib/client-info";
import { useT } from "@/lib/messages";
import { openExternal } from "@/lib/open-external";
import { accountErrorKey } from "@atomic/core";
import { useAccountState, useLocale } from "@atomic/core/react";
import { CloudOff, MailWarning, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AiBadge, useAi } from "../ai/ai-ui";
import { SettingsRow, SettingsSection } from "../settings/settings-section";
import { Switch } from "../ui/switch";
import { Notice, Spinner } from "./account-ui";
import { formatClock } from "./format";

/**
 * Settings → AI assistant (Beta) (Annex C §1.6, §1.8 and §4; D31–D32),
 * also on the Account page:
 * - "AI suggestions": on opens the consent dialog; off withdraws consent on
 *   the account (every device) and removes translations;
 * - "Translate my content to the app language" (default off), only when the
 *   server translates; off removes every translation;
 * - today's use against the plan's limit, where requests are processed,
 *   and that nothing is stored;
 * - unverified email and offline notices (resending sits in the verify
 *   notice of the account card or the Account page).
 * Hidden without an account, on servers without AI, and in the artifact
 * build. Owner: T5.
 */
export function AiSettingsSection() {
	const { t } = useT();
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
			toast.success(done);
		} catch (error) {
			toast.error(t(accountErrorKey(error)));
		} finally {
			setBusy(null);
		}
	};

	const onSuggestChange = (on: boolean) => {
		if (on) ask();
		else void save("suggest", { suggestions: false, translate: false }, t("ai.turnedOff"));
	};
	const onTranslateChange = (on: boolean) =>
		void save(
			"translate",
			{ suggestions: true, translate: on },
			on ? t("ai.translateStarted") : t("ai.translateCleared"),
		);

	const where =
		feature.hosting === "hosted" && feature.providerName
			? t("ai.consentWhere.hosted", { provider: feature.providerName })
			: t("ai.consentWhere.self");

	const suggestUsage =
		consented && suggestLimit !== null && feature.suggest
			? `${t("ai.usageSuggest", { used: t.number(Math.max(0, suggestUsed)), limit: t.number(suggestLimit) })} · ${t("plan.usage.resets", { time: resets })}`
			: null;
	const translateUsage =
		consented && availability.translateOn && translateLimit !== null
			? t("ai.usageTranslate", {
					used: t.number(Math.max(0, translateUsed)),
					limit: t.number(translateLimit),
				})
			: null;

	return (
		<SettingsSection id="ai" title={t("ai.title")} badge={availability.beta ? <AiBadge /> : null}>
			{unverified || offline ? (
				<div className="px-4 pt-4 pb-3">
					{unverified ? (
						// "Resend email" is in the verify notice of the account card
						// (Settings) or at the top of the Account page.
						<Notice tone="info" icon={<MailWarning />}>
							{t("ai.error.unverified")}
						</Notice>
					) : (
						<Notice tone="info" icon={<CloudOff />}>
							{t("ai.error.offline")}
						</Notice>
					)}
				</div>
			) : null}
			<SettingsRow
				label={t("ai.suggestToggle")}
				hint={<Hint text={t("ai.suggestHint")} usage={suggestUsage} />}
				htmlFor="settings-ai-suggest"
			>
				<span className="flex items-center gap-2">
					{busy === "suggest" ? <Spinner className="size-4 text-ink-muted" /> : null}
					<Switch
						id="settings-ai-suggest"
						checked={consented}
						disabled={offline || busy !== null || (unverified && !consented)}
						onCheckedChange={onSuggestChange}
					/>
				</span>
			</SettingsRow>
			{feature.translate ? (
				<SettingsRow
					label={t("ai.translateToggle")}
					hint={<Hint text={t("ai.translateHint")} usage={translateUsage} />}
					htmlFor="settings-ai-translate"
				>
					<span className="flex items-center gap-2">
						{busy === "translate" ? <Spinner className="size-4 text-ink-muted" /> : null}
						<Switch
							id="settings-ai-translate"
							checked={consented && availability.translateOn}
							disabled={!consented || offline || unverified || busy !== null}
							onCheckedChange={onTranslateChange}
						/>
					</span>
				</SettingsRow>
			) : null}
			<div className="flex items-start gap-2.5 px-5 py-4 text-ink-muted text-small">
				<ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
				<p className="min-w-0">
					{where} {t("ai.consentStore")}{" "}
					{privacyUrl ? (
						<a
							href={privacyUrl}
							target="_blank"
							rel="noopener noreferrer"
							onClick={(event) => {
								if (!isTauri) return;
								event.preventDefault();
								void openExternal(privacyUrl);
							}}
							className="whitespace-nowrap rounded-sm font-medium text-accent-text underline-offset-4 hover:underline"
						>
							{t("ai.privacy")}
						</a>
					) : null}
				</p>
			</div>
		</SettingsSection>
	);
}

function Hint({ text, usage }: { text: string; usage: string | null }) {
	return (
		<>
			<span className="block">{text}</span>
			{usage ? <span className="mt-1 block text-ink tabular-nums">{usage}</span> : null}
		</>
	);
}
