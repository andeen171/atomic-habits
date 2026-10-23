import {
	type ExistingDataChoice,
	type Plan,
	createAccountController,
	createWebStorage,
} from "@atomic/core";
import { create } from "zustand";
import { billingClient } from "./client-info";
import { downloadUrl } from "./download";
import { isArtifactBuild } from "./runtime";
import { store } from "./store";
import { syncController } from "./sync";

/**
 * The signed-in account (Annex C §3.5, §4): profile, plan, usage and every
 * account action, plus the device-wide UI state the account flows share.
 *
 * - The account refreshes when the window regains focus (at most once a
 *   minute; at once while the email waits for confirmation), so a
 *   confirmed email or a plan bought elsewhere shows up.
 * - The export link (D69) downloads in place; desktop hands it to the
 *   system browser.
 * - Desktop checkout runs in the system browser, so the plan is re-checked
 *   when the window comes back within 10 minutes (Annex C §1.5).
 *
 * Owner: T5.
 */
export const accountController = createAccountController({
	sync: syncController,
	cache: createWebStorage(),
	store,
	openUrl: (url) => downloadUrl(url),
});

// ── Auth dialog (opened from Settings, the Account page, banners) ──

export type AuthMode = "signIn" | "signUp" | "reset";

interface AuthDialogState {
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

export const useAuthDialog = create<AuthDialogState>((set) => ({
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

/** Where Stripe sends the web app back to (`#/account?billing=…`); desktop and native use the server's page. */
export function billingReturnUrl(): string | undefined {
	if (billingClient !== "web" || typeof window === "undefined") return undefined;
	return `${window.location.origin}${window.location.pathname}#/account`;
}

// ── Desktop checkout: re-check the plan when the window returns ──

const CHECKOUT_KEY = "atomic-habits:checkout-started";
const CHECKOUT_WINDOW_MS = 10 * 60 * 1000;

/** Desktop opened checkout in the system browser just now. */
export function noteCheckoutStarted(): void {
	try {
		localStorage.setItem(CHECKOUT_KEY, String(Date.now()));
	} catch {
		// No storage: the next focus refresh still catches the plan.
	}
}

/** Called on focus: true (once) when a desktop checkout started in the last 10 minutes. */
export function takeRecentCheckout(): boolean {
	try {
		const started = Number(localStorage.getItem(CHECKOUT_KEY));
		if (!started) return false;
		localStorage.removeItem(CHECKOUT_KEY);
		return Date.now() - started < CHECKOUT_WINDOW_MS;
	} catch {
		return false;
	}
}

interface PlanWaitState {
	/** A purchase is being confirmed (the plan card shows it). */
	confirming: boolean;
	setConfirming(confirming: boolean): void;
}

export const usePlanWait = create<PlanWaitState>((set) => ({
	confirming: false,
	setConfirming: (confirming) => set({ confirming }),
}));

/** Polls until the plan is `plan` (webhooks are authoritative), showing "Confirming…". */
export async function confirmPlan(plan: Plan = "pro"): Promise<boolean> {
	const { setConfirming } = usePlanWait.getState();
	setConfirming(true);
	try {
		const reached = await accountController.waitForPlan(plan);
		// A full photo storage may have room now.
		if (reached) void syncController.syncBlobs();
		return reached;
	} finally {
		setConfirming(false);
	}
}

// ── Coming back to the app ──

/** A confirmation link was most likely just opened from the inbox: check again this soon. */
const VERIFY_CHECK_MS = 5_000;
let verifyCheckedAt = 0;

/**
 * The window is back in front: refresh the account at most once a minute
 * (`notifyFocus`), or right away while the email waits for confirmation on
 * a server that sends email, so "Verify your email" (and the AI and
 * checkout it gates) clears as soon as the user returns from the link.
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

if (!isArtifactBuild && typeof window !== "undefined") {
	const onFocus = () => {
		// Back from a checkout in the system browser (desktop): confirm the plan.
		if (takeRecentCheckout()) void confirmPlan();
		else refreshOnReturn();
	};
	window.addEventListener("focus", onFocus);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") onFocus();
	});
}
