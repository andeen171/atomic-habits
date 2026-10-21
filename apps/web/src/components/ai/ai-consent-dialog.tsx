import { accountController } from "@/lib/account";
import { useAiConsent } from "@/lib/ai";
import { isTauri } from "@/lib/client-info";
import { useT } from "@/lib/messages";
import { openExternal } from "@/lib/open-external";
import { accountErrorKey } from "@atomic/core";
import { Gauge, Send, Server, ShieldCheck, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "../account/account-ui";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
} from "../ui/dialog";
import { Switch } from "../ui/switch";
import { AiBadge, useAi } from "./ai-ui";

/**
 * "Turn on AI suggestions?" (Annex C §1.6, LGPD art. 8): what is sent, where
 * it goes, that nothing is stored or used for training, the daily limit and
 * that AI can be wrong — plus the separate, default-off "Translate my
 * content" switch. Consent is stored on the account (`ai.setConsent`), so
 * the user's other devices inherit it. Opened through `useAiConsent().ask()`
 * and mounted once, in `CloudBanners`. Owner: T5.
 */
export function AiConsentDialog() {
	const open = useAiConsent((s) => s.open);
	const close = useAiConsent((s) => s.close);
	return (
		<Dialog open={open} onOpenChange={(next) => (next ? undefined : close(false))}>
			{open ? <ConsentContent onDone={close} /> : null}
		</Dialog>
	);
}

function ConsentContent({ onDone }: { onDone(granted: boolean): void }) {
	const { t } = useT();
	const { availability, feature, plan, limits, billing, privacyUrl } = useAi();
	const [translate, setTranslate] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const translateId = useId();
	const beta = availability.beta || feature?.beta !== false;

	// The account changed under the dialog (signed out, AI switched off): nothing to consent to.
	useEffect(() => {
		if (!feature) onDone(false);
	}, [feature, onDone]);

	const where =
		feature?.hosting === "hosted" && feature.providerName
			? t("ai.consentWhere.hosted", { provider: feature.providerName })
			: t("ai.consentWhere.self");
	const perDay = limits?.aiRequestsPerDay ?? null;
	const limitLine =
		perDay === null
			? null
			: billing && plan === "free"
				? t("ai.consentLimits", { count: perDay })
				: t("ai.consentLimitsYours", { count: perDay });

	const turnOn = async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const consent = await accountController.setAiConsent({
				suggestions: true,
				translate: Boolean(feature?.translate) && translate,
			});
			toast.success(t("ai.turnedOn"), {
				description: consent.translate ? t("ai.translateStarted") : undefined,
			});
			onDone(true);
		} catch (failure) {
			setError(t(accountErrorKey(failure)));
		} finally {
			setBusy(false);
		}
	};

	return (
		<DialogContent size="sm">
			<DialogHeader
				title={
					<span className="flex flex-wrap items-center gap-2">
						{t("ai.consentTitle")}
						{beta ? <AiBadge /> : null}
					</span>
				}
				description={false}
			/>
			<DialogBody className="flex flex-col gap-5 pt-3">
				<DialogDescription asChild>
					<ul className="flex flex-col gap-3.5">
						<Point icon={<Send />}>{t("ai.consentWhat")}</Point>
						<Point icon={<Server />}>{where}</Point>
						<Point icon={<ShieldCheck />}>{t("ai.consentStore")}</Point>
						{limitLine ? <Point icon={<Gauge />}>{limitLine}</Point> : null}
						<Point icon={<Sparkles />}>{t("ai.consentBeta")}</Point>
					</ul>
				</DialogDescription>
				{feature?.translate ? (
					<div className="flex items-start justify-between gap-4 rounded-lg border border-line bg-sunken/40 p-3.5">
						<label htmlFor={translateId} className="min-w-0">
							<span className="block font-medium text-ink text-small">
								{t("ai.translateToggle")}
							</span>
							<span className="mt-0.5 block text-ink-muted text-small">
								{t("ai.translateHint")}
							</span>
						</label>
						<Switch id={translateId} checked={translate} onCheckedChange={setTranslate} />
					</div>
				) : null}
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
						className="self-start rounded-sm font-medium text-accent-text text-small underline-offset-4 hover:underline"
					>
						{t("ai.privacy")}
					</a>
				) : null}
				{error ? (
					<p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-ink text-small">
						{error}
					</p>
				) : null}
			</DialogBody>
			<DialogFooter>
				<Button variant="secondary" onClick={() => onDone(false)}>
					{t("ai.notNow")}
				</Button>
				<Button onClick={() => void turnOn()} disabled={busy} aria-busy={busy || undefined}>
					{busy ? <Spinner /> : <Sparkles />}
					{t("ai.turnOn")}
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<li className="flex items-start gap-3 text-ink text-small leading-snug">
			<span
				aria-hidden="true"
				className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text [&_svg]:size-3.5"
			>
				{icon}
			</span>
			<span className="min-w-0 pt-1">{children}</span>
		</li>
	);
}
