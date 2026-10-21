import { Check, CircleAlert, CreditCard, ExternalLink } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { accountController, billingUi, finishBilling, usePlanWait } from "@/lib/account";
import { billingClient } from "@/lib/client-info";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { openBillingSession } from "@/lib/open-external";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type AccountInfo,
	type BillingInterval,
	type Offer,
	type ServerInfo,
	billingErrorKey,
	formatOffer,
} from "@atomic/core";
import { useAccountState } from "@atomic/core/react";
import { withAlpha } from "@atomic/core/theme";
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import { Divider, InlineError, Notice, PlanBadge, Spinner } from "./account-ui";
import { formatBytes, formatClock, formatDate } from "./format";
import { UsageMeter } from "./usage-meter";

/**
 * Account → Plan and usage (Annex C §1.4–1.5, §5; D25, D27):
 * - billing off (self-hosting): "Everything is included on this server";
 * - free with billing on: in `external` builds, what Pro adds, then
 *   "Upgrade · R$ 9,90/month" and "R$ 79,90/year · Save 33%" (checkout
 *   needs a confirmed email where the server sends email); store builds
 *   (`status`) show the status only, never a purchase path;
 * - Pro: renews / ends / trial / grace, and Manage billing (`external`);
 * - while a purchase is confirmed: "Confirming your payment…";
 * - usage meters: AI today, translation today, photo storage, sync storage.
 * Checkout and the portal open in an auth session that comes back to
 * `atomic://billing`. Owner: T5.
 */
export function PlanSection() {
	const t = useT();
	const styles = useStyles();
	const { account, server, status } = useAccountState(accountController);
	const confirming = usePlanWait((s) => s.confirming);
	return (
		<>
			<SectionLabel>{t.t("plan.title")}</SectionLabel>
			<Card padding={0} style={styles.block} testID="plan-section">
				<View style={styles.body} accessibilityState={{ busy: confirming }}>
					{account ? (
						<>
							{confirming ? (
								<Notice tone="info" iconNode={<Spinner />}>
									{t.t("plan.confirming")}
								</Notice>
							) : null}
							<PlanStatus account={account} server={server} />
						</>
					) : status === "error" ? (
						<LoadError />
					) : (
						<PlanSkeleton />
					)}
				</View>
				{account ? (
					<>
						<Divider />
						<UsageMeters account={account} server={server} />
					</>
				) : null}
			</Card>
		</>
	);
}

function PlanStatus({ account, server }: { account: AccountInfo; server: ServerInfo | null }) {
	const t = useT();
	const styles = useStyles();
	const ent = account.entitlements;
	const billing = server?.features.billing ?? null;
	const external = billingUi === "external";
	let line: string | null = null;
	if (ent.source === "billing-disabled" || !billing) line = t.t("plan.included");
	else if (ent.source === "grant")
		line = ent.endsAt ? t.t("plan.ends", { date: formatDate(ent.endsAt, t) }) : t.t("plan.granted");
	else if (ent.status === "active" && ent.renewsAt)
		line = t.t("plan.renews", { date: formatDate(ent.renewsAt, t) });
	else if (ent.status === "canceling" && ent.endsAt)
		line = t.t("plan.ends", { date: formatDate(ent.endsAt, t) });
	else if (ent.status === "trialing" && ent.endsAt)
		line = t.t("plan.trialEnds", { date: formatDate(ent.endsAt, t) });
	else if (ent.plan === "free") line = t.t("plan.coreFree");

	const grace = ent.status === "grace" && ent.graceUntil !== null;
	const offerUpgrade = external && !!billing && ent.plan === "free";

	return (
		<View style={styles.status}>
			<View style={styles.statusRow}>
				<PlanBadge plan={ent.plan} large />
				{line ? (
					<Text variant="small" tone="muted" style={styles.statusLine}>
						{line}
					</Text>
				) : null}
			</View>
			{external && billing && ent.canManageBilling && !grace ? (
				<PortalButton variant="secondary" />
			) : null}
			{grace && ent.graceUntil ? (
				<Notice
					tone="warning"
					alert
					icon={CreditCard}
					actions={
						external ? <PortalButton variant="secondary" label={t.t("plan.updateCard")} /> : null
					}
				>
					{t.t("plan.grace", { date: formatDate(ent.graceUntil, t) })}
				</Notice>
			) : null}
			{offerUpgrade && billing ? (
				<Upgrade account={account} server={server} offers={billing.offers} />
			) : null}
		</View>
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
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [busy, setBusy] = useState<BillingInterval | null>(null);
	const [error, setError] = useState<string | null>(null);
	const monthly = offers.find((o) => o.interval === "month") ?? null;
	const yearly = offers.find((o) => o.interval === "year") ?? null;
	const needsVerify = !account.emailVerified && server?.features.email === true;

	const checkout = async (interval: BillingInterval) => {
		haptics.selection();
		setBusy(interval);
		setError(null);
		try {
			const url = await accountController.checkout(interval, billingClient);
			const outcome = await openBillingSession(url);
			setBusy(null);
			await finishBilling(outcome);
		} catch (caught) {
			haptics.warning();
			setError(t.t(billingErrorKey(caught)));
			setBusy(null);
		}
	};

	const savePercent =
		monthly && yearly && monthly.currency === yearly.currency && monthly.amount > 0
			? 1 - yearly.amount / (12 * monthly.amount)
			: 0;
	const yearlyLabel = yearly
		? [
				t.t("plan.upgradeYearly", { price: formatOffer(yearly, t.locale) }),
				savePercent >= 0.05 ? t.t("plan.yearlySave", { percent: t.percent(savePercent) }) : null,
			]
				.filter(Boolean)
				.join(" · ")
		: null;

	return (
		<View
			style={[
				styles.upgrade,
				{
					borderColor: withAlpha(colors.accent, 0.3),
					backgroundColor: withAlpha(colors.accentSoft, 0.55),
				},
			]}
			testID="plan-upgrade"
		>
			<View style={styles.upgradeHead}>
				<Text variant="display">{t.t("plan.proTitle")}</Text>
				<Text variant="small" tone="muted">
					{t.t("plan.proHint")}
				</Text>
			</View>
			<Compare server={server} />
			{needsVerify ? (
				// "Resend email" lives in the verify notice at the top of the screen.
				<Notice tone="info" icon={CircleAlert}>
					{t.t("plan.verifyFirst")}
				</Notice>
			) : null}
			<View style={styles.upgradeButtons}>
				<Button
					label={
						monthly
							? t.t("plan.upgradeMonthly", { price: formatOffer(monthly, t.locale) })
							: t.t("plan.upgrade")
					}
					size="lg"
					loading={busy === "month"}
					disabled={needsVerify || (busy !== null && busy !== "month")}
					onPress={() => void checkout("month")}
					testID="plan-upgrade-month"
				/>
				{yearly || !offers.length ? (
					<Button
						label={yearlyLabel ?? t.t("plan.yearly")}
						variant="secondary"
						size="lg"
						loading={busy === "year"}
						disabled={needsVerify || (busy !== null && busy !== "year")}
						onPress={() => void checkout("year")}
						testID="plan-upgrade-year"
					/>
				) : null}
			</View>
			{error ? <InlineError>{error}</InlineError> : null}
		</View>
	);
}

/** Free and Pro side by side, from the server's per-plan limits (when it publishes them). */
function Compare({ server }: { server: ServerInfo | null }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const limits = server?.features.ai?.limits;
	const free = limits?.free;
	const pro = limits?.pro;
	if (!free || !pro) return null;
	const rows: { label: string; free: string; pro: string }[] = [];
	if (server?.features.ai?.suggest)
		rows.push({
			label: t.t("plan.compare.ai"),
			free: t.number(free.aiRequestsPerDay),
			pro: t.number(pro.aiRequestsPerDay),
		});
	if (server?.features.blobs)
		rows.push({
			label: t.t("plan.usage.storage"),
			free: formatBytes(free.blobBytes, t),
			pro: formatBytes(pro.blobBytes, t),
		});
	rows.push({
		label: t.t("plan.usage.sync"),
		free: formatBytes(free.syncBytes, t),
		pro: formatBytes(pro.syncBytes, t),
	});
	return (
		<View accessibilityLabel={t.t("plan.compareLabel")}>
			<View style={styles.compareRow} accessibilityElementsHidden importantForAccessibility="no">
				<View style={styles.compareLabel} />
				<Text variant="small" tone="muted" weight="medium" style={styles.compareFree}>
					{t.t("plan.free")}
				</Text>
				<Text variant="small" weight="semibold" style={styles.comparePro}>
					{t.t("plan.pro")}
				</Text>
			</View>
			{rows.map((row) => (
				<View
					key={row.label}
					style={[styles.compareRow, styles.compareBody, { borderTopColor: colors.border }]}
					accessible
					accessibilityLabel={`${row.label}: ${t.t("plan.free")} ${row.free}, ${t.t("plan.pro")} ${row.pro}`}
				>
					<Text variant="small" style={styles.compareLabel}>
						{row.label}
					</Text>
					<Text variant="small" tone="muted" tabular style={styles.compareFree}>
						{row.free}
					</Text>
					<View style={[styles.comparePro, styles.compareProCell]}>
						<Check size={13} color={colors.success} strokeWidth={2.6} />
						<Text variant="small" weight="semibold" tabular>
							{row.pro}
						</Text>
					</View>
				</View>
			))}
		</View>
	);
}

/** Manage billing / Update card: Stripe's customer portal (`external` builds). */
function PortalButton({ variant, label }: { variant: "secondary" | "ghost"; label?: string }) {
	const t = useT();
	const styles = useStyles();
	const [opening, setOpening] = useState(false);
	const open = async () => {
		setOpening(true);
		try {
			const url = await accountController.billingPortal(billingClient);
			const outcome = await openBillingSession(url);
			await finishBilling(outcome === "dismissed" ? "portal" : outcome);
		} catch (error) {
			showToast(t.t(billingErrorKey(error)), { tone: "danger" });
		} finally {
			setOpening(false);
		}
	};
	return (
		<Button
			label={label ?? t.t("plan.manage")}
			icon={ExternalLink}
			variant={variant}
			size="sm"
			loading={opening}
			onPress={() => void open()}
			style={styles.portal}
			testID="plan-portal"
		/>
	);
}

function UsageMeters({ account, server }: { account: AccountInfo; server: ServerInfo | null }) {
	const t = useT();
	const styles = useStyles();
	const { usage, entitlements } = account;
	const limits = entitlements.limits;
	const ai = server?.features.ai ?? null;
	const blobsFull = !!server?.features.blobs && usage.blobBytes >= limits.blobBytes;
	const bytes = (value: number) => formatBytes(value, t);
	const count = (value: number) => t.number(value);
	return (
		<View style={styles.usage} testID="plan-usage">
			<Text variant="label" tone="subtle" accessibilityRole="header">
				{t.t("plan.usageTitle")}
			</Text>
			{ai?.suggest ? (
				<UsageMeter
					label={t.t("plan.usage.ai")}
					used={usage.aiRequestsToday}
					limit={limits.aiRequestsPerDay}
					format={count}
					hint={t.t("plan.usage.resets", { time: formatClock(usage.aiResetsAt, t.locale) })}
				/>
			) : null}
			{ai?.translate && account.ai.translate ? (
				<UsageMeter
					label={t.t("plan.usage.translate")}
					used={usage.aiTranslateCharsToday}
					limit={limits.aiTranslateCharsPerDay}
					format={count}
				/>
			) : null}
			{server?.features.blobs ? (
				<UsageMeter
					label={t.t("plan.usage.storage")}
					used={usage.blobBytes}
					limit={limits.blobBytes}
					format={bytes}
					hint={blobsFull ? t.t("plan.storageFull") : null}
				/>
			) : null}
			<UsageMeter
				label={t.t("plan.usage.sync")}
				used={usage.syncBytes}
				limit={limits.syncBytes}
				format={bytes}
			/>
		</View>
	);
}

function PlanSkeleton() {
	const { colors } = useTheme();
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const pulse = useSharedValue(1);
	useEffect(() => {
		if (reduceMotion) return;
		pulse.value = withRepeat(withTiming(0.45, { duration: 800 }), -1, true);
	}, [reduceMotion, pulse]);
	const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
	const bar = (width: number | `${number}%`, height: number) => (
		<View style={{ width, height, borderRadius: height / 2, backgroundColor: colors.sunken }} />
	);
	return (
		<Animated.View
			style={[styles.skeleton, style]}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		>
			{bar(120, 28)}
			{bar("75%", 14)}
			{bar("100%", 8)}
			{bar("100%", 8)}
		</Animated.View>
	);
}

/** The account couldn't load (offline, server trouble): try again. */
export function LoadError() {
	const t = useT();
	const { error } = useAccountState(accountController);
	return (
		<Notice
			tone="warning"
			icon={CircleAlert}
			actions={
				<Button
					label={t.t("account.retry")}
					variant="secondary"
					size="sm"
					onPress={() => void accountController.refresh()}
				/>
			}
		>
			{error === "network" ? t.t("account.errors.network") : t.t("account.errors.server")}
		</Notice>
	);
}

const useStyles = makeStyles((t) => ({
	block: { marginBottom: 24 },
	body: { padding: 16, gap: 14 },
	status: { gap: 14 },
	statusRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
	statusLine: { flex: 1, minWidth: 160 },
	portal: { alignSelf: "flex-start" },
	upgrade: { gap: 14, padding: 16, borderRadius: t.radii.lg, borderWidth: 1 },
	upgradeHead: { gap: 4 },
	upgradeButtons: { gap: 10 },
	compareRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
	compareBody: { borderTopWidth: 1, paddingVertical: 9 },
	compareLabel: { flex: 1 },
	compareFree: { width: 72, textAlign: "right" },
	comparePro: { width: 86, textAlign: "right" },
	compareProCell: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "flex-end",
		gap: 4,
	},
	usage: { padding: 16, gap: 16 },
	skeleton: { gap: 12 },
}));
