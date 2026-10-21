import {
	accountController,
	billingReturnUrl,
	noteCheckoutStarted,
	usePlanWait,
} from "@/lib/account";
import { billingClient } from "@/lib/client-info";
import { useT } from "@/lib/messages";
import { openExternal } from "@/lib/open-external";
import {
	type AccountInfo,
	type BillingInterval,
	type Offer,
	type ServerInfo,
	billingErrorKey,
	formatOffer,
} from "@atomic/core";
import { useAccountState, useLocale } from "@atomic/core/react";
import { Check, CircleAlert, CreditCard, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "../settings/settings-section";
import { Button } from "../ui/button";
import { Notice, PlanBadge, Spinner } from "./account-ui";
import { formatBytes, formatClock, formatDate } from "./format";
import { UsageMeter } from "./usage-meter";

/**
 * Plan and usage (Annex C §1.4–1.5, §4; D25, D27):
 * - billing off (self-hosting): "Everything is included on this server";
 * - free with billing on: what Pro adds, then "Upgrade · R$ 9,90/month" and
 *   "R$ 79,90/year · Save 33%" (price-less when the server has no offers);
 *   checkout needs a confirmed email where the server sends email;
 * - Pro: renews / ends / trial / grace (with "Update card"), and Manage
 *   billing (Stripe's portal);
 * - while a purchase is confirmed: "Confirming your payment…" (`aria-busy`);
 * - usage meters: AI today, translation today, photo storage, sync storage.
 * Checkout and the portal open outside the app (`openExternal`). Owner: T5.
 */
export function PlanCard() {
	const { t } = useT();
	const { account, server, status } = useAccountState(accountController);
	const confirming = usePlanWait((s) => s.confirming);

	return (
		<SettingsSection id="plan" title={t("plan.title")}>
			<div className="flex flex-col gap-5 px-5 py-5" aria-busy={confirming || undefined}>
				{account ? (
					<>
						{confirming ? (
							<Notice tone="info" icon={<Spinner />}>
								{t("plan.confirming")}
							</Notice>
						) : null}
						<PlanStatus account={account} server={server} />
						<UsageMeters account={account} server={server} />
					</>
				) : status === "error" ? (
					<LoadError />
				) : (
					<PlanSkeleton />
				)}
			</div>
		</SettingsSection>
	);
}

function PlanStatus({ account, server }: { account: AccountInfo; server: ServerInfo | null }) {
	const { t } = useT();
	const locale = useLocale();
	const ent = account.entitlements;
	const billing = server?.features.billing ?? null;
	let line: string | null = null;
	if (ent.source === "billing-disabled" || !billing) line = t("plan.included");
	else if (ent.source === "grant")
		line = ent.endsAt
			? t("plan.ends", { date: formatDate(ent.endsAt, locale) })
			: t("plan.granted");
	else if (ent.status === "active" && ent.renewsAt)
		line = t("plan.renews", { date: formatDate(ent.renewsAt, locale) });
	else if (ent.status === "canceling" && ent.endsAt)
		line = t("plan.ends", { date: formatDate(ent.endsAt, locale) });
	else if (ent.status === "trialing" && ent.endsAt)
		line = t("plan.trialEnds", { date: formatDate(ent.endsAt, locale) });
	else if (ent.plan === "free") line = t("plan.coreFree");

	const grace = ent.status === "grace" && ent.graceUntil !== null;
	const offerUpgrade = !!billing && ent.plan === "free";

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<PlanBadge plan={ent.plan} className="h-7 px-3" />
				{line ? <p className="min-w-0 flex-1 text-ink-muted text-small">{line}</p> : null}
				{billing && ent.canManageBilling && !grace ? <PortalButton variant="secondary" /> : null}
			</div>
			{grace && ent.graceUntil ? (
				<Notice
					tone="warning"
					role="alert"
					icon={<CreditCard />}
					actions={<PortalButton variant="secondary" label={t("plan.updateCard")} />}
				>
					{t("plan.grace", { date: formatDate(ent.graceUntil, locale) })}
				</Notice>
			) : null}
			{offerUpgrade && billing ? (
				<Upgrade account={account} server={server} offers={billing.offers} />
			) : null}
		</div>
	);
}

function Upgrade({
	account,
	server,
	offers,
}: {
	account: AccountInfo;
	server: ServerInfo | null;
	offers: readonly Offer[];
}) {
	const { t } = useT();
	const locale = useLocale();
	const [busy, setBusy] = useState<BillingInterval | null>(null);
	const [error, setError] = useState<string | null>(null);
	const monthly = offers.find((o) => o.interval === "month") ?? null;
	const yearly = offers.find((o) => o.interval === "year") ?? null;
	const needsVerify = !account.emailVerified && server?.features.email === true;

	const checkout = async (interval: BillingInterval) => {
		setBusy(interval);
		setError(null);
		try {
			const url = await accountController.checkout(interval, billingClient, billingReturnUrl());
			if (billingClient === "desktop") {
				noteCheckoutStarted();
				toast(t("plan.checkoutOpened"));
				setBusy(null);
			}
			await openExternal(url);
		} catch (caught) {
			setError(t(billingErrorKey(caught)));
			setBusy(null);
		}
	};

	const savePercent =
		monthly && yearly && monthly.currency === yearly.currency && monthly.amount > 0
			? 1 - yearly.amount / (12 * monthly.amount)
			: 0;
	const yearlyLabel = yearly
		? [
				t("plan.upgradeYearly", { price: formatOffer(yearly, locale) }),
				savePercent >= 0.05 ? t("plan.yearlySave", { percent: t.percent(savePercent) }) : null,
			]
				.filter(Boolean)
				.join(" · ")
		: null;

	return (
		<div className="flex flex-col gap-4 rounded-xl border border-accent/30 bg-accent-soft/40 p-4 md:p-5">
			<div>
				<p className="font-display text-h2 text-ink">{t("plan.proTitle")}</p>
				<p className="mt-1 text-ink-muted text-small">{t("plan.proHint")}</p>
			</div>
			<Compare server={server} />
			{needsVerify ? (
				// "Resend email" lives in the verify notice at the top of the page.
				<Notice tone="info" icon={<CircleAlert />}>
					{t("plan.verifyFirst")}
				</Notice>
			) : null}
			<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
				<Button
					disabled={needsVerify || busy !== null}
					onClick={() => void checkout("month")}
					className="h-auto min-h-10 w-full whitespace-normal py-2 sm:w-auto"
				>
					{busy === "month" ? <Spinner /> : null}
					{monthly
						? t("plan.upgradeMonthly", { price: formatOffer(monthly, locale) })
						: t("plan.upgrade")}
				</Button>
				{yearly || !offers.length ? (
					<Button
						variant="secondary"
						disabled={needsVerify || busy !== null}
						onClick={() => void checkout("year")}
						className="h-auto min-h-10 w-full whitespace-normal py-2 sm:w-auto"
					>
						{busy === "year" ? <Spinner /> : null}
						{yearlyLabel ?? t("plan.yearly")}
					</Button>
				) : null}
			</div>
			{error ? (
				<p role="alert" className="flex items-start gap-2 text-ink text-small">
					<CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
					{error}
				</p>
			) : null}
		</div>
	);
}

/** Free and Pro side by side, from the server's per-plan limits (when it publishes them). */
function Compare({ server }: { server: ServerInfo | null }) {
	const { t } = useT();
	const limits = server?.features.ai?.limits;
	const free = limits?.free;
	const pro = limits?.pro;
	if (!free || !pro) return null;
	const rows: { label: string; free: string; pro: string }[] = [];
	if (server?.features.ai?.suggest)
		rows.push({
			label: t("plan.compare.ai"),
			free: t.number(free.aiRequestsPerDay),
			pro: t.number(pro.aiRequestsPerDay),
		});
	if (server?.features.blobs)
		rows.push({
			label: t("plan.usage.storage"),
			free: formatBytes(free.blobBytes, t),
			pro: formatBytes(pro.blobBytes, t),
		});
	rows.push({
		label: t("plan.usage.sync"),
		free: formatBytes(free.syncBytes, t),
		pro: formatBytes(pro.syncBytes, t),
	});
	return (
		<table className="w-full border-collapse text-small">
			<caption className="sr-only">{t("plan.compareLabel")}</caption>
			<thead>
				<tr className="text-ink-muted">
					<th scope="col" className="py-1.5 pr-3 text-left font-normal">
						<span className="sr-only">{t("plan.compareFeature")}</span>
					</th>
					<th scope="col" className="w-[22%] px-2 py-1.5 text-right font-medium">
						{t("plan.free")}
					</th>
					<th scope="col" className="w-[22%] py-1.5 pl-2 text-right font-semibold text-ink">
						{t("plan.pro")}
					</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr key={row.label} className="border-line/70 border-t">
						<th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
							{row.label}
						</th>
						<td className="whitespace-nowrap px-2 py-2 text-right text-ink-muted tabular-nums">
							{row.free}
						</td>
						<td className="whitespace-nowrap py-2 pl-2 text-right font-semibold text-ink tabular-nums">
							<span className="inline-flex items-center gap-1">
								<Check aria-hidden="true" className="size-3.5 text-success" />
								{row.pro}
							</span>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function PortalButton({ variant, label }: { variant: "secondary" | "ghost"; label?: string }) {
	const { t } = useT();
	const [opening, setOpening] = useState(false);
	const open = async () => {
		setOpening(true);
		try {
			const url = await accountController.billingPortal(billingClient, billingReturnUrl());
			await openExternal(url);
		} catch (error) {
			toast.error(t(billingErrorKey(error)));
		} finally {
			setOpening(false);
		}
	};
	return (
		<Button variant={variant} size="sm" disabled={opening} onClick={() => void open()}>
			{opening ? <Spinner /> : <ExternalLink />}
			{label ?? t("plan.manage")}
		</Button>
	);
}

function UsageMeters({ account, server }: { account: AccountInfo; server: ServerInfo | null }) {
	const { t } = useT();
	const locale = useLocale();
	const { usage, entitlements } = account;
	const limits = entitlements.limits;
	const ai = server?.features.ai ?? null;
	const blobsFull = server?.features.blobs && usage.blobBytes >= limits.blobBytes;
	const bytes = (value: number) => formatBytes(value, t);
	const count = (value: number) => t.number(value);
	return (
		<section
			aria-label={t("plan.usageTitle")}
			className="flex flex-col gap-4 border-line border-t pt-5"
		>
			<h3 className="font-semibold text-ink-muted text-tiny uppercase tracking-[0.08em]">
				{t("plan.usageTitle")}
			</h3>
			{ai?.suggest ? (
				<UsageMeter
					label={t("plan.usage.ai")}
					used={usage.aiRequestsToday}
					limit={limits.aiRequestsPerDay}
					format={count}
					hint={t("plan.usage.resets", { time: formatClock(usage.aiResetsAt, locale) })}
				/>
			) : null}
			{ai?.translate && account.ai.translate ? (
				<UsageMeter
					label={t("plan.usage.translate")}
					used={usage.aiTranslateCharsToday}
					limit={limits.aiTranslateCharsPerDay}
					format={count}
				/>
			) : null}
			{server?.features.blobs ? (
				<UsageMeter
					label={t("plan.usage.storage")}
					used={usage.blobBytes}
					limit={limits.blobBytes}
					format={bytes}
					hint={blobsFull ? t("plan.storageFull") : null}
				/>
			) : null}
			<UsageMeter
				label={t("plan.usage.sync")}
				used={usage.syncBytes}
				limit={limits.syncBytes}
				format={bytes}
			/>
		</section>
	);
}

function PlanSkeleton() {
	return (
		<div
			aria-hidden="true"
			className="flex animate-pulse flex-col gap-4 motion-reduce:animate-none"
		>
			<div className="h-7 w-40 rounded-full bg-sunken" />
			<div className="h-4 w-3/4 rounded-full bg-sunken" />
			<div className="mt-2 h-2 w-full rounded-full bg-sunken" />
			<div className="h-2 w-full rounded-full bg-sunken" />
		</div>
	);
}

export function LoadError() {
	const { t } = useT();
	const { error } = useAccountState(accountController);
	return (
		<Notice
			tone="warning"
			icon={<CircleAlert />}
			actions={
				<Button variant="secondary" size="sm" onClick={() => void accountController.refresh()}>
					{t("account.retry")}
				</Button>
			}
		>
			{error === "network" ? t("account.errors.network") : t("account.errors.server")}
		</Notice>
	);
}
