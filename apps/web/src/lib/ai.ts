import { type AiClient, createAiClient } from "@atomic/core";
import { create } from "zustand";
import { accountController } from "./account";
import { isArtifactBuild } from "./runtime";
import { store } from "./store";
import { syncController } from "./sync";

/**
 * The AI beta client (spec §3.6, §5.9, D31–D32; Annex C §1.6, §1.8, §4).
 *
 * - Availability follows the account and the server: the sparkle buttons,
 *   the AI settings section and the consent dialog read it.
 * - Suggestions are only ever asked for by the user (a tap on the sparkle);
 *   the journal is never sent (D19).
 * - The translation runner (only with the account's "Translate my content"
 *   switch on) starts from `main.tsx` through `startAi()`.
 *
 * Null in the artifact build: no account, AI or translations (spec §1.3).
 * Owner: T5.
 */
export const aiClient: AiClient | null = isArtifactBuild
	? null
	: createAiClient({ store, sync: syncController, account: accountController });

let started = false;

/** Starts the translation runner and follows connectivity (once, outside the artifact). */
export function startAi(): void {
	if (!aiClient || started || typeof window === "undefined") return;
	started = true;
	aiClient.startTranslationRunner();
	const refresh = () => aiClient.refresh();
	window.addEventListener("online", refresh);
	window.addEventListener("offline", refresh);
}

// ── Consent dialog (opened by a sparkle, the settings switch, or the account page) ──

interface ConsentDialogState {
	open: boolean;
	/** Called once consent is given (a sparkle then opens its suggestions). */
	onGranted: (() => void) | null;
	ask(onGranted?: () => void): void;
	/** Closes; `granted` runs the pending callback. */
	close(granted: boolean): void;
}

export const useAiConsent = create<ConsentDialogState>((set, get) => ({
	open: false,
	onGranted: null,
	ask: (onGranted) => set({ open: true, onGranted: onGranted ?? null }),
	close(granted) {
		const callback = get().onGranted;
		set({ open: false, onGranted: null });
		if (granted) callback?.();
	},
}));
