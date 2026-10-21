import { AiSettingsSection } from "@/components/account/ai-settings-section";
import { DangerCard } from "@/components/account/danger-card";
import { DataCard } from "@/components/account/data-card";
import { PlanCard } from "@/components/account/plan-card";
import { ProfileCard } from "@/components/account/profile-card";
import { SecurityCard } from "@/components/account/security-card";
import { SignedOutPanel } from "@/components/account/signed-out-panel";
import { SyncCard } from "@/components/account/sync-card";
import { SyncSwitchRows } from "@/components/account/sync-rows";
import { VerifyBanner } from "@/components/account/verify-banner";
import { Page, PageHeader } from "@/components/layout/page";
import { SettingsSection } from "@/components/settings/settings-section";
import { accountController, confirmPlan } from "@/lib/account";
import { fireConfetti } from "@/lib/celebrate";
import { useT } from "@/lib/messages";
import { isArtifactBuild } from "@/lib/runtime";
import { syncController } from "@/lib/sync";
import { BILLING_RESULTS, type BillingResult } from "@atomic/core";
import { useAtomicStore, useSyncState } from "@atomic/core/react";
import { palettes } from "@atomic/core/theme";
import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CloudUpload } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

interface AccountSearch {
	/** Stripe sends the web app back here (`/billing/return`, Annex C §1.5). */
	billing?: BillingResult;
}

export const Route = createFileRoute("/_app/account")({
	validateSearch: (search: Record<string, unknown>): AccountSearch => {
		const billing = search.billing;
		return typeof billing === "string" && (BILLING_RESULTS as readonly string[]).includes(billing)
			? { billing: billing as BillingResult }
			: {};
	},
	component: AccountScreen,
});

/**
 * The Account page (Annex C §4, spec §5.9). Signed in: plan and usage,
 * the AI assistant (when the server has AI), sync, profile, security
 * (password, devices), your data (export, refused and newer-version items)
 * and sign out / delete, under one "Verify your email" notice while the
 * address is unconfirmed. Opening the page refreshes the account. Signed out: the
 * sign-in choices and the device's sync switches. Coming back from Stripe
 * (`?billing=success`) confirms the plan. The artifact build has no
 * accounts (spec §1.3). Owner: T5.
 */
function AccountScreen() {
	const { t } = useT();
	const sync = useSyncState(syncController);
	const signedIn = sync.user !== null;
	useBillingReturn();
	// Opening the page shows the plan and usage as they are now (the first
	// backup may have finished since sign-in).
	useEffect(() => {
		if (signedIn && !isArtifactBuild) void accountController.refresh().catch(() => null);
	}, [signedIn]);
	if (isArtifactBuild) return <Navigate to="/settings" replace />;
	return (
		<Page>
			<Link
				to="/settings"
				className="mb-5 inline-flex items-center gap-1.5 rounded-sm font-medium text-ink-muted text-small hover:text-ink"
			>
				<ArrowLeft className="size-4" />
				{t("nav.settings")}
			</Link>
			<PageHeader
				title={t("account.title")}
				subtitle={sync.user ? <span className="break-all">{sync.user.email}</span> : undefined}
			/>
			{sync.user ? (
				<div className="flex flex-col gap-8">
					{/* "Verify your email": recovery, AI and upgrades all wait for it. */}
					<VerifyBanner />
					<PlanCard />
					<AiSettingsSection />
					<SyncCard />
					<ProfileCard />
					<SecurityCard />
					<DataCard />
					<DangerCard />
				</div>
			) : (
				<div className="flex flex-col gap-8">
					<SignedOutHero />
					<SettingsSection id="sync" title={t("settings.sync")}>
						<SyncSwitchRows />
					</SettingsSection>
				</div>
			)}
		</Page>
	);
}

function SignedOutHero() {
	const { t } = useT();
	return (
		<section
			aria-labelledby="account-hero-title"
			className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
		>
			<div className="flex flex-col gap-5 p-5 md:p-7">
				<div className="flex items-start gap-4">
					<span
						aria-hidden="true"
						className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-ink"
					>
						<CloudUpload className="size-6" />
					</span>
					<div className="min-w-0">
						<h2 id="account-hero-title" className="font-display text-h2 text-ink">
							{t("account.rowSignedOut")}
						</h2>
						<p className="mt-1 max-w-prose text-ink-muted">{t("account.sectionHint")}</p>
					</div>
				</div>
				<SignedOutPanel size="lg" />
			</div>
		</section>
	);
}

/**
 * `?billing=success`: "Confirming your payment…" until the plan is Pro
 * (webhooks are authoritative; at most 30 s), then a welcome, or "Your
 * plan will update shortly". `cancel` says nothing was charged; `portal`
 * refreshes quietly. The parameter is then removed.
 */
function useBillingReturn() {
	const { t } = useT();
	const navigate = useNavigate();
	const store = useAtomicStore();
	const { billing } = Route.useSearch();
	const handled = useRef<string | null>(null);
	useEffect(() => {
		if (!billing || handled.current === billing) return;
		handled.current = billing;
		void navigate({ to: "/account", search: {}, replace: true });
		if (billing === "cancel") {
			toast(t("plan.canceled"));
			return;
		}
		if (billing === "portal") {
			void accountController.refresh();
			return;
		}
		void confirmPlan("pro").then((reached) => {
			if (!reached) {
				toast(t("plan.pendingUpdate"));
				return;
			}
			toast.success(t("plan.welcome"));
			if (store.getState().settings.celebrations) {
				const { accent, success, warning } = palettes.light;
				fireConfetti([accent, success, warning]);
			}
		});
	}, [billing, navigate, store, t]);
}
