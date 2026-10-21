import {
	Clock,
	CloudAlert,
	CreditCard,
	Download,
	HardDrive,
	LogIn,
	type LucideIcon,
	RefreshCw,
	ServerCog,
	TriangleAlert,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { accountController, billingUi, finishBilling, useAuthSheet } from "@/lib/account";
import { exportBackup } from "@/lib/backup";
import { billingClient } from "@/lib/client-info";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { kv } from "@/lib/kv";
import { useReduceMotion } from "@/lib/motion";
import { openBillingSession } from "@/lib/open-external";
import { syncController } from "@/lib/sync";
import { makeStyles } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { type SyncControllerState, billingErrorKey } from "@atomic/core";
import type { CloudBanner } from "@atomic/core/react";
import { useActions, useAtomic, useCloudBanners, useSyncState } from "@atomic/core/react";
import { router, usePathname } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { AiConsentSheet } from "../ai/ai-consent-sheet";
import { Notice, type NoticeTone, Spinner } from "./account-ui";
import { AuthSheet } from "./auth-sheet";
import { formatDate } from "./format";
import { MergeSheet } from "./merge-sheet";
import { UpdateBanner, useUpdateOffer } from "./update-banner";
import { VerifyNotice } from "./verify-notice";

/** Below the screens' 52pt top bar, so back buttons stay reachable. */
const TOP_BAR = 52;
/** Banners float over the screen: at most this many at once, most urgent first. */
const MAX_VISIBLE = 2;

/**
 * App-wide cloud and storage banners, mounted once in `app/_layout.tsx`
 * (spec §5.9, §6; Annex C §1.3–1.4), most urgent first:
 * - `persistError`: this device couldn't save (blocking, "Export backup");
 * - session ended (password reset, revoked device): "Sign in again";
 * - payment grace: "Update card" (billing portal; status only in store builds);
 * - sync storage full: "See plan";
 * - partial data: restoring from the account, or export what's here;
 * - retrying after failed rounds that lasted (backoff): "Try now";
 * - clock skew, outdated server, documents from a newer version;
 * - verify email (inline instead on Settings and Account);
 * - the Android "Update available" banner.
 *
 * They float below the top bar, at most two at a time. Everything but the
 * failed-save banner can be dismissed; that is remembered on this device
 * and the banner comes back when the situation changes (a new day, version,
 * count…). It also hosts the sign-in, merge and AI consent sheets, so every
 * screen can open them. Owner: T5.
 */
export function CloudBanners() {
	return (
		<>
			<BannerStack />
			<AuthSheet />
			<MergeSheet />
			<AiConsentSheet />
		</>
	);
}

// ── Dismissals (per device; a new situation shows the banner again) ──

const DISMISS_KEY = "atomic-habits:cloud-banners-dismissed";

const useDismissed = create<{
	dismissed: Record<string, string>;
	dismiss(kind: string, signature: string): void;
}>((set, get) => ({
	dismissed: {},
	dismiss(kind, signature) {
		const dismissed = { ...get().dismissed, [kind]: signature };
		set({ dismissed });
		Promise.resolve(kv.setItem(DISMISS_KEY, JSON.stringify(dismissed))).catch(() => {
			// Remembered until the app restarts.
		});
	},
}));

Promise.resolve(kv.getItem(DISMISS_KEY))
	.then((raw) => {
		const parsed = raw ? (JSON.parse(raw) as unknown) : null;
		if (!parsed || typeof parsed !== "object") return;
		// Dismissals made before the stored ones arrived win.
		useDismissed.setState((s) => ({
			dismissed: { ...(parsed as Record<string, string>), ...s.dismissed },
		}));
	})
	.catch(() => {});

/**
 * True once rounds have kept failing for `ms` (network or server errors).
 * The retries in between ("syncing") don't reset the streak; a successful
 * round, sign-out or a lost session does. Returns the streak's start too.
 */
function useFailingFor(sync: SyncControllerState, ms: number): number | null {
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
		const id = setTimeout(() => rerender((n) => n + 1), left + 50);
		return () => clearTimeout(id);
	}, [started, ms]);
	return streak && started !== null && Date.now() - started >= ms ? started : null;
}

/** Show the retry banner only after the 10 s and 30 s retries failed too. */
const BACKOFF_BANNER_AFTER_MS = 45_000;

interface BannerSpec {
	key: string;
	tone: NoticeTone;
	alert?: boolean;
	icon?: LucideIcon;
	iconNode?: ReactNode;
	text: string;
	actions?: ReactNode;
	/** Dismissible: remembered against this signature. */
	signature?: string;
	/** Dismissing does something instead (session ended: forget the error). */
	onDismiss?: () => void;
	/** Rendered by its own component (verify email, update). */
	render?: (onDismiss: () => void) => ReactNode;
}

const today = () => new Date().toDateString();

function BannerStack() {
	const t = useT();
	const insets = useSafeAreaInsets();
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const pathname = usePathname();
	const openAuth = useAuthSheet((s) => s.openAuth);
	const sync = useSyncState(syncController);
	const cloud = useCloudBanners(syncController, accountController);
	const partial = useAtomic((s) => s.partial && s.hydrated);
	const update = useUpdateOffer();
	const { dismissed, dismiss } = useDismissed();
	const backoffSince = useFailingFor(sync, BACKOFF_BANNER_AFTER_MS);
	const onboarding = pathname === "/onboarding";
	// The Account screen and the Settings card show these inline.
	const inlineVerify = pathname === "/account" || pathname === "/settings";

	const specs: BannerSpec[] = [];
	const persistError = cloud.some((b) => b.kind === "persist-error");

	if (persistError) {
		specs.push({
			key: "persist-error",
			tone: "danger",
			alert: true,
			icon: TriangleAlert,
			text: t.t("sync.persistError"),
			actions: <ExportButton />,
		});
	}
	for (const banner of cloud as readonly CloudBanner[]) {
		switch (banner.kind) {
			case "session-ended":
				specs.push({
					key: "session-ended",
					tone: "warning",
					alert: true,
					icon: LogIn,
					text: t.t("account.errors.sessionEnded"),
					actions: (
						<Button
							label={t.t("account.signInAgain")}
							variant="secondary"
							size="sm"
							onPress={() => openAuth("signIn")}
							testID="banner-sign-in"
						/>
					),
					onDismiss: () => syncController.clearError(),
				});
				break;
			case "payment-grace":
				// The Account screen's plan section shows it inline.
				if (pathname === "/account") break;
				specs.push({
					key: "payment-grace",
					tone: "warning",
					alert: true,
					icon: CreditCard,
					text: t.t("plan.grace", { date: formatDate(banner.until, t) }),
					actions: billingUi === "external" ? <PortalButton /> : undefined,
					signature: today(),
				});
				break;
			case "quota-full":
				specs.push({
					key: "quota-full",
					tone: "warning",
					icon: HardDrive,
					text: t.t("sync.quotaFull"),
					actions:
						pathname === "/account" ? undefined : (
							<Button
								label={t.t("plan.view")}
								variant="secondary"
								size="sm"
								onPress={() => router.push("/account")}
							/>
						),
					signature: today(),
				});
				break;
			case "clock-skew":
				specs.push({
					key: "clock-skew",
					tone: "warning",
					icon: Clock,
					text: t.t("sync.clockSkew", { minutes: t.number(banner.minutes) }),
					// Back every day while the clock stays wrong.
					signature: today(),
				});
				break;
			case "server-outdated":
				specs.push({
					key: "server-outdated",
					tone: "info",
					icon: ServerCog,
					text: t.t("sync.serverOutdated"),
					signature: `${sync.serverUrl ?? ""}@${sync.server?.version ?? ""}`,
				});
				break;
			case "verify-email":
				if (!inlineVerify) {
					specs.push({
						key: "verify-email",
						tone: "info",
						text: "",
						signature: banner.email,
						render: (onDismiss) => <VerifyNotice floating onDismiss={onDismiss} />,
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
						iconNode: <Spinner />,
						text: t.t("sync.partialRestoring"),
						signature: "restoring",
					}
				: {
						key: "partial",
						tone: "warning",
						icon: TriangleAlert,
						text: t.t("sync.partialLocal"),
						actions: <ExportButton />,
						signature: today(),
					},
		);
	}
	if (backoffSince !== null) {
		specs.push({
			key: "backoff",
			tone: "info",
			icon: CloudAlert,
			text: t.t("sync.retrying"),
			actions: (
				<Button
					label={t.t("sync.tryNow")}
					icon={RefreshCw}
					variant="secondary"
					size="sm"
					onPress={() => {
						haptics.light();
						syncController.notifyOnline();
					}}
					testID="banner-try-now"
				/>
			),
			signature: String(backoffSince),
		});
	}
	if (sync.user && sync.supersededCount > 0) {
		specs.push({
			key: "superseded",
			tone: "info",
			icon: RefreshCw,
			text: t.tp("sync.supersededBanner", sync.supersededCount),
			actions: update ? (
				<Button
					label={t.t("account.updateAction")}
					icon={Download}
					variant="secondary"
					size="sm"
					onPress={() => void Linking.openURL(update.url)}
				/>
			) : undefined,
			signature: String(sync.supersededCount),
		});
	}
	if (update) {
		specs.push({
			key: "update",
			tone: "info",
			text: "",
			render: () => <UpdateBanner />,
		});
	}

	const visible = specs
		.filter((spec) => (onboarding ? spec.key === "persist-error" : true))
		.filter((spec) => !spec.signature || dismissed[spec.key] !== spec.signature)
		.slice(0, MAX_VISIBLE);

	return (
		<View
			pointerEvents="box-none"
			style={[styles.layer, { top: insets.top + TOP_BAR + 4 }]}
			testID="cloud-banners"
		>
			{visible.map((spec) => {
				const onDismiss = spec.signature
					? () => dismiss(spec.key, spec.signature ?? "")
					: spec.onDismiss;
				return (
					<Animated.View
						key={spec.key}
						entering={reduceMotion ? undefined : FadeInUp.duration(220)}
						exiting={reduceMotion ? undefined : FadeOutUp.duration(160)}
						layout={reduceMotion ? undefined : LinearTransition.duration(200)}
					>
						{spec.render ? (
							spec.render(onDismiss ?? (() => {}))
						) : (
							<Notice
								tone={spec.tone}
								alert={spec.alert}
								icon={spec.icon}
								iconNode={spec.iconNode}
								actions={spec.actions}
								onDismiss={onDismiss}
								floating
								testID={`banner-${spec.key}`}
							>
								{spec.text}
							</Notice>
						)}
					</Animated.View>
				);
			})}
		</View>
	);
}

/** "Export backup": this device's data to the share sheet. */
function ExportButton() {
	const t = useT();
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
		<Button
			label={t.t("settings.export")}
			icon={Download}
			variant="ink"
			size="sm"
			onPress={() => void onExport()}
			testID="persist-error-export"
		/>
	);
}

/** "Update card": the Stripe customer portal (payment grace; `external` builds only). */
function PortalButton() {
	const t = useT();
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
			label={t.t("plan.updateCard")}
			icon={CreditCard}
			variant="secondary"
			size="sm"
			loading={opening}
			onPress={() => void open()}
		/>
	);
}

const useStyles = makeStyles(() => ({
	layer: { position: "absolute", left: 12, right: 12, zIndex: 50, gap: 8 },
}));
