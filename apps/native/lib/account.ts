import {
	type ExistingDataChoice,
	type Plan,
	createAccountController,
	createTranslator,
} from "@atomic/core";
import { create } from "zustand";
import { appLocale } from "./client-info";
import { haptics } from "./haptics";
import { kv } from "./kv";
import { type CheckoutOutcome, saveAccountExport } from "./open-external";
import { store } from "./store";
import { syncController } from "./sync";
import { showToast, ui } from "./ui-store";

/**
 * The signed-in account (Annex C §3.5, §5): profile, plan, usage and every
 * account action, plus the device-wide UI state the account flows share.
 *
 * - The account refreshes when the app comes back to the foreground (at
 *   most once a minute, at once while the email waits for confirmation:
 *   `refreshOnReturn`, called by `lib/lifecycle.ts`), so a confirmed email
 *   or a plan bought elsewhere shows up.
 * - The export link (D69) downloads to the cache and opens the share sheet.
 * - Checkout runs in an auth session; its result, or the
 *   `atomic://billing?result=…` link (`app/+native-intent.tsx`), confirms
 *   the plan (`finishBilling`).
 *
 * Owner: T5.
 */
export const accountController = createAccountController({
	sync: syncController,
	cache: kv,
	store,
	openUrl: saveAccountExport,
});

/**
 * `EXPO_PUBLIC_BILLING_UI` (D27): store builds show the plan's status only
 * (`status`, the default: no purchase UI); sideloaded and preview builds
 * open Stripe in the browser (`external`).
 */
export const billingUi: "status" | "external" =
	process.env.EXPO_PUBLIC_BILLING_UI === "external" ? "external" : "status";

// ── Coming back to the app ──

/** A confirmation link was most likely just opened from the inbox: check again this soon. */
const VERIFY_CHECK_MS = 5_000;
let verifyCheckedAt = 0;

/**
 * The app is back in the foreground: refresh the account at most once a
 * minute (`notifyFocus`), or right away while the email waits for
 * confirmation on a server that sends email, so "Verify your email" (and
 * the AI and checkout it gates) clears as soon as the user returns from
 * the link.
 */
export function refreshOnReturn(): void {
	const { account, server, status } = accountController.getState();
	const awaitingConfirmation =
		!!account && !account.emailVerified && server?.features.email === true;
	if (awaitingConfirmation && status !== "loading") {
		if (Date.now() - verifyCheckedAt < VERIFY_CHECK_MS) return;
		verifyCheckedAt = Date.now();
		void accountController.refresh().catch(() => null);
		return;
	}
	accountController.notifyFocus();
}

// ── Auth sheet (opened from Settings, the Account screen, banners) ──

export type AuthMode = "signIn" | "signUp" | "reset";

interface AuthSheetState {
	open: boolean;
	mode: AuthMode;
	/** Open with the "Advanced · self-hosting" server section expanded. */
	advanced: boolean;
	/** Bumped on every opening: the form starts fresh each time. */
	session: number;
	openAuth(mode?: AuthMode, opts?: { advanced?: boolean }): void;
	setMode(mode: AuthMode): void;
	close(): void;
}

export const useAuthSheet = create<AuthSheetState>((set) => ({
	open: false,
	mode: "signIn",
	advanced: false,
	session: 0,
	openAuth: (mode = "signIn", opts = {}) =>
		set((state) => ({
			open: true,
			mode,
			advanced: opts.advanced ?? false,
			session: state.session + 1,
		})),
	setMode: (mode) => set({ mode }),
	close: () => set({ open: false }),
}));

// ── First sign-in on a device with data (D37) ──

interface MergeState {
	/** Live entities on this device, while the question is open. */
	ask: { localCount: number; resolve(choice: ExistingDataChoice): void } | null;
	answer(choice: ExistingDataChoice): void;
}

export const useMergePrompt = create<MergeState>((set, get) => ({
	ask: null,
	answer(choice) {
		const pending = get().ask;
		set({ ask: null });
		pending?.resolve(choice);
	},
}));

/**
 * The `onExistingData` option of every sign-in: asks Merge / Use account /
 * Cancel and resolves with the answer. A question still open is canceled.
 */
export function askExistingData(info: { localCount: number }): Promise<ExistingDataChoice> {
	useMergePrompt.getState().ask?.resolve("cancel");
	return new Promise((resolve) => {
		useMergePrompt.setState({ ask: { localCount: info.localCount, resolve } });
	});
}

// ── A session that ended (a password reset elsewhere, a revoked device) ──

/** The account whose session ended, until the next sign-in or a plain sign-out. */
let endedEmail: string | null = null;
let currentEmail: string | null = null;
syncController.subscribe(() => {
	const { user, sessionEnded } = syncController.getState();
	if (user) {
		currentEmail = user.email;
		endedEmail = null;
		return;
	}
	endedEmail = sessionEnded ? (currentEmail ?? endedEmail) : null;
	if (!sessionEnded) currentEmail = null;
});

/** "Sign in again" fills in the email of the account whose session ended. */
export function endedSessionEmail(): string | null {
	return endedEmail;
}

/**
 * The `onExistingData` option of an email sign-in. Signing back in to the
 * account whose session just ended merges without asking: this device's
 * data came from that account, and its waiting changes must not be lost.
 * Any other account asks Merge / Use account / Cancel (D37).
 */
export function existingDataFor(
	email: string,
): (info: { localCount: number }) => Promise<ExistingDataChoice> {
	const same = !!endedEmail && email.trim().toLowerCase() === endedEmail.trim().toLowerCase();
	return same ? async () => "merge" : askExistingData;
}

// ── Billing ──

interface PlanWaitState {
	/** A purchase is being confirmed (the plan section shows it). */
	confirming: boolean;
}

export const usePlanWait = create<PlanWaitState>(() => ({ confirming: false }));

let confirmation: Promise<boolean> | null = null;

/** Polls until the plan is `plan` (webhooks are authoritative), showing "Confirming…". */
export function confirmPlan(plan: Plan = "pro"): Promise<boolean> {
	if (confirmation) return confirmation;
	usePlanWait.setState({ confirming: true });
	confirmation = accountController
		.waitForPlan(plan)
		.then((reached) => {
			// A full photo storage may have room now.
			if (reached) void syncController.syncBlobs();
			return reached;
		})
		.finally(() => {
			usePlanWait.setState({ confirming: false });
			confirmation = null;
		});
	return confirmation;
}

/** The same result arriving twice (auth session and deep link) is handled once. */
let lastOutcome: { outcome: CheckoutOutcome; at: number } | null = null;

/**
 * After checkout or the billing portal (Annex C §1.5): `success` confirms
 * the plan ("Welcome to Pro", with confetti when celebrations are on, or
 * "Your plan will update shortly"); `cancel` says nothing was charged;
 * `portal` and a closed browser refresh quietly.
 */
export async function finishBilling(outcome: CheckoutOutcome): Promise<void> {
	const now = Date.now();
	if (lastOutcome && lastOutcome.outcome === outcome && now - lastOutcome.at < 5000) return;
	lastOutcome = { outcome, at: now };
	const t = createTranslator(appLocale());
	if (outcome === "cancel") {
		showToast(t.t("plan.canceled"));
		return;
	}
	if (outcome !== "success") {
		await accountController.refresh().catch(() => null);
		return;
	}
	const reached = await confirmPlan("pro");
	if (!reached) {
		showToast(t.t("plan.pendingUpdate"));
		return;
	}
	haptics.success();
	showToast(t.t("plan.welcome"), { tone: "success" });
	// `Celebration` skips the burst when celebrations are off.
	ui.celebrate();
}
