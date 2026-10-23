import { accountController, billingReturnUrl, useAuthDialog } from "@/lib/account";
import { useArtifactCloudStatus } from "@/lib/artifact-cloud";
import { billingClient } from "@/lib/client-info";
import { downloadJson } from "@/lib/download";
import { useT } from "@/lib/messages";
import { openExternal } from "@/lib/open-external";
import { isArtifactBuild } from "@/lib/runtime";
import { syncController } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { type SyncControllerState, billingErrorKey } from "@atomic/core";
import type { CloudBanner } from "@atomic/core/react";
import {
	useActions,
	useAtomic,
	useCloudBanners,
	useLocale,
	useSyncState,
	useToday,
} from "@atomic/core/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
	Clock,
	CloudAlert,
	CloudOff,
	CreditCard,
	Download,
	HardDrive,
	LogIn,
	MailWarning,
	RefreshCw,
	ServerCog,
	TriangleAlert,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { AiConsentDialog } from "../ai/ai-consent-dialog";
import { Button } from "../ui/button";
import { Notice, type NoticeTone, Spinner } from "./account-ui";
import { AuthDialog } from "./auth-dialog";
import { formatDate } from "./format";
import { MergeDialog } from "./merge-dialog";
import { VerifyBanner } from "./verify-banner";

/**
 * Account and storage banners above every page of the shell (spec §5.9,
 * Annex C §1.3–1.4), most urgent first:
 * - `persistError`: this device couldn't save (blocking, "Export backup");
 * - session ended (password reset, revoked device): "Sign in again";
 * - payment grace: "Update card" (billing portal);
 * - sync storage full: "See plan";
 * - partial data: restoring from the account, or export what's here;
 * - retrying after a failed round that lasted (backoff): "Try now";
 * - clock skew, outdated server, documents from a newer version;
 * - verify email (shown inline instead on Settings and Account);
 * - the artifact's "Cloud saving paused".
 * Calm ones can be dismissed; that is remembered per device and comes back
 * when the situation changes. Alerts use `role="alert"`, the rest `status`.
 *
 * It also hosts the sign-in, merge and AI consent dialogs, so every page can open them.
 * Owner: T5.
 */
export function CloudBanners() {
	return (
		<>
			<BannerStack />
			{isArtifactBuild ? null : (
				<>
					<AuthDialog />
					<MergeDialog />
					<AiConsentDialog />
				</>
			)}
		</>
	);
}

// ── Dismissals (per device; a new situation shows the banner again) ──

const DISMISS_KEY = "atomic-habits:cloud-banners-dismissed";

function readDismissed(): Record<string, string> {
	try {
		const raw = localStorage.getItem(DISMISS_KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : null;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
	} catch {
		return {};
	}
}

const useDismissed = create<{
	dismissed: Record<string, string>;
	dismiss(kind: string, signature: string): void;
}>((set, get) => ({
	dismissed: typeof window === "undefined" ? {} : readDismissed(),
	dismiss(kind, signature) {
		const dismissed = { ...get().dismissed, [kind]: signature };
		set({ dismissed });
		try {
			localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissed));
		} catch {
			// Remembered for this session only.
		}
	},
}));

/**
 * True once rounds have kept failing for `ms` (network or server errors).
 * The retries in between ("syncing") don't reset the streak; a successful
 * round, sign-out or a lost session does.
 */
function useFailingFor(sync: SyncControllerState, ms: number): boolean {
	const since = useRef<number | null>(null);
	const [, rerender] = useState(0);
	const failed =
		!!sync.user && sync.status === "error" && sync.error !== null && sync.error !== "auth";
	const streak = !!sync.user && (failed || (sync.status === "syncing" && since.current !== null));
	if (!streak) since.current = null;
	else if (failed && since.current === null) since.current = Date.now();
	const started = since.current;
	useEffect(() => {
		if (started === null) return;
		const left = started + ms - Date.now();
		if (left <= 0) return;
		const id = window.setTimeout(() => rerender((n) => n + 1), left + 50);
		return () => window.clearTimeout(id);
	}, [started, ms]);
	return streak && started !== null && Date.now() - started >= ms;
}

/** Show the retry banner only after the 10 s and 30 s retries failed too. */
const BACKOFF_BANNER_AFTER_MS = 45_000;

interface BannerSpec {
	key: string;
	tone: NoticeTone;
	role: "alert" | "status";
	icon: ReactNode;
	text: ReactNode;
	actions?: ReactNode;
	/** Dismissible: remembered against this signature. */
	signature?: string;
	onDismiss?: () => void;
	/** Stays on screen while scrolling (the blocking ones). */
	sticky?: boolean;
}

function BannerStack() {
	const { t } = useT();
	const locale = useLocale();
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const openAuth = useAuthDialog((s) => s.openAuth);
	const sync = useSyncState(syncController);
	const cloud = useCloudBanners(syncController, accountController);
	const partial = useAtomic((s) => s.partial && s.hydrated);
	const artifactCloud = useArtifactCloudStatus();
	const { dismissed, dismiss } = useDismissed();
	const backoff = useFailingFor(sync, BACKOFF_BANNER_AFTER_MS);
	// The Account page and the Settings card show the verify notice inline.
	const verifyInline = pathname === "/account" || pathname === "/settings";

	const specs: BannerSpec[] = [];
	const has = (kind: CloudBanner["kind"]) => cloud.some((b) => b.kind === kind);
	const persistError = has("persist-error");

	if (persistError) {
		specs.push({
			key: "persist-error",
			tone: "danger",
			role: "alert",
			icon: <TriangleAlert />,
			text: t("sync.persistError"),
			actions: <ExportButton />,
			sticky: true,
		});
	}
	for (const banner of cloud) {
		switch (banner.kind) {
			case "session-ended":
				specs.push({
					key: "session-ended",
					tone: "warning",
					role: "alert",
					icon: <LogIn />,
					text: t("account.errors.sessionEnded"),
					actions: (
						<Button variant="secondary" size="sm" onClick={() => openAuth("signIn")}>
							{t("account.signInAgain")}
						</Button>
					),
					onDismiss: () => syncController.clearError(),
				});
				break;
			case "payment-grace":
				specs.push({
					key: "payment-grace",
					tone: "warning",
					role: "alert",
					icon: <CreditCard />,
					text: t("plan.grace", { date: formatDate(banner.until, locale) }),
					actions: <PortalButton />,
				});
				break;
			case "quota-full":
				specs.push({
					key: "quota-full",
					tone: "warning",
					role: "status",
					icon: <HardDrive />,
					text: t("sync.quotaFull"),
					actions:
						pathname === "/account" ? undefined : (
							<Button
								variant="secondary"
								size="sm"
								onClick={() => void navigate({ to: "/account" })}
							>
								{t("plan.view")}
							</Button>
						),
				});
				break;
			case "clock-skew":
				specs.push({
					key: "clock-skew",
					tone: "warning",
					role: "status",
					icon: <Clock />,
					text: t("sync.clockSkew", { minutes: t.number(banner.minutes) }),
					// Back every day while the clock stays wrong.
					signature: new Date().toDateString(),
				});
				break;
			case "server-outdated":
				specs.push({
					key: "server-outdated",
					tone: "info",
					role: "status",
					icon: <ServerCog />,
					text: t("sync.serverOutdated"),
					signature: `${sync.serverUrl ?? ""}@${sync.server?.version ?? ""}`,
				});
				break;
			case "verify-email":
				if (!verifyInline) {
					specs.push({
						key: "verify-email",
						tone: "info",
						role: "status",
						icon: <MailWarning />,
						text: null,
						signature: banner.email,
					});
				}
				break;
		}
	}
	if (partial && !persistError) {
		specs.push(
			sync.user
				? {
						key: "partial",
						tone: "info",
						role: "status",
						icon: <Spinner />,
						text: t("sync.partialRestoring"),
					}
				: {
						key: "partial",
						tone: "warning",
						role: "status",
						icon: <TriangleAlert />,
						text: t(isArtifactBuild ? "sync.persistError" : "sync.partialLocal"),
						actions: <ExportButton />,
					},
		);
	}
	if (backoff) {
		specs.push({
			key: "backoff",
			tone: "info",
			role: "status",
			icon: <CloudAlert />,
			text: t("sync.retrying"),
			actions: (
				<Button variant="secondary" size="sm" onClick={() => syncController.notifyOnline()}>
					<RefreshCw />
					{t("sync.tryNow")}
				</Button>
			),
		});
	}
	if (sync.user && sync.supersededCount > 0) {
		specs.push({
			key: "superseded",
			tone: "info",
			role: "status",
			icon: <RefreshCw />,
			text: t.tp("sync.supersededBanner", sync.supersededCount),
			actions: (
				<Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
					{t("app.reload")}
				</Button>
			),
			signature: String(sync.supersededCount),
		});
	}
	if (artifactCloud === "paused") {
		specs.push({
			key: "cloud-paused",
			tone: "warning",
			role: "status",
			icon: <CloudOff />,
			text: t("sync.cloudPaused"),
			actions: <ExportButton />,
		});
	}

	const visible = specs.filter((spec) => !spec.signature || dismissed[spec.key] !== spec.signature);
	if (!visible.length) return null;
	const sticky = visible.some((spec) => spec.sticky);

	return (
		<div
			className={cn(
				"z-20 flex flex-col gap-2 px-5 pt-3 md:px-8 lg:px-10",
				sticky && "sticky top-0 bg-bg/90 pb-1 backdrop-blur-xl",
			)}
		>
			{visible.map((spec) =>
				spec.key === "verify-email" ? (
					<div key={spec.key} className="mx-auto w-full max-w-[1160px]">
						<VerifyDismissible onDismiss={() => dismiss(spec.key, spec.signature ?? "")} />
					</div>
				) : (
					<Notice
						key={spec.key}
						tone={spec.tone}
						role={spec.role}
						icon={spec.icon}
						actions={spec.actions}
						onDismiss={
							spec.signature
								? () => dismiss(spec.key, spec.signature ?? "")
								: (spec.onDismiss ?? undefined)
						}
						className="mx-auto max-w-[1160px]"
					>
						{spec.text}
					</Notice>
				),
			)}
		</div>
	);
}

/** The verify notice with a dismiss button (only in the global stack). */
function VerifyDismissible({ onDismiss }: { onDismiss(): void }) {
	return (
		<div className="relative">
			<VerifyBanner className="pr-12" />
			<DismissCorner onDismiss={onDismiss} />
		</div>
	);
}

function DismissCorner({ onDismiss }: { onDismiss(): void }) {
	const { t } = useT();
	return (
		<button
			type="button"
			aria-label={t("sync.dismiss")}
			onClick={onDismiss}
			className="sm:-translate-y-1/2 absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface/60 hover:text-ink sm:top-1/2"
		>
			<X aria-hidden="true" className="size-4" />
		</button>
	);
}

function ExportButton() {
	const { t, at } = useT();
	const actions = useActions();
	const today = useToday();
	const exportBackup = async () => {
		const saved = await downloadJson(`atomic-backup-${today}.json`, actions.exportData());
		if (saved) toast.success(at("settings.exported"));
		else toast.error(at("settings.exportUnavailable"));
	};
	return (
		<Button variant="secondary" size="sm" onClick={() => void exportBackup()}>
			<Download />
			{t("settings.export")}
		</Button>
	);
}

/** "Update card": the Stripe customer portal (payment grace). */
function PortalButton() {
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
		<Button variant="secondary" size="sm" disabled={opening} onClick={() => void open()}>
			{opening ? <Spinner /> : <CreditCard />}
			{t("plan.updateCard")}
		</Button>
	);
}
