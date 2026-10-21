import { type AiClient, createAiClient } from "@atomic/core";
import { AppState, Platform } from "react-native";
import { create } from "zustand";
import { accountController } from "./account";
import { appLocale } from "./client-info";
import { store } from "./store";
import { syncController } from "./sync";

/**
 * The AI beta client (spec §3.6, §6, D31–D32; Annex C §1.6, §1.8, §5).
 *
 * - Availability follows the account and the server: the sparkle buttons,
 *   the AI settings section and the consent sheet read it.
 * - Suggestions are only ever asked for by the user (a tap on the sparkle);
 *   the journal is never sent (D19).
 * - The translation runner (only with the account's "Translate my content"
 *   switch on) starts with the app (`startAi()`, from `lib/lifecycle.ts`).
 *
 * Owner: T5.
 */

/**
 * Connectivity without a network module: the browser's flag on the web
 * export; on devices, the last sync round didn't fail for the network (the
 * sparkle then says "AI suggestions need a connection", and a tap retries).
 */
function isOnline(): boolean {
	if (Platform.OS === "web") {
		const online = (globalThis as { navigator?: { onLine?: unknown } }).navigator?.onLine;
		if (typeof online === "boolean") return online;
	}
	return syncController.getState().error !== "network";
}

export const aiClient: AiClient = createAiClient({
	store,
	sync: syncController,
	account: accountController,
	isOnline,
	locale: appLocale,
});

let started = false;

/**
 * Starts the translation runner and follows connectivity: coming back to
 * the app (and the web export's online/offline events) re-reads it. Once.
 */
export function startAi(): void {
	if (started) return;
	started = true;
	aiClient.startTranslationRunner();
	AppState.addEventListener("change", (state) => {
		if (state === "active") aiClient.refresh();
	});
	if (Platform.OS === "web" && typeof window !== "undefined") {
		const refresh = () => aiClient.refresh();
		window.addEventListener("online", refresh);
		window.addEventListener("offline", refresh);
	}
}

/** The sparkle while offline: try the server again now (the sync round re-reads connectivity). */
export function retryConnection(): void {
	syncController.notifyOnline();
	aiClient.refresh();
}

// ── Consent sheet (opened by a sparkle, the settings switch, or the account screen) ──

interface ConsentSheetState {
	open: boolean;
	/** Called once consent is given (a sparkle then opens its suggestions). */
	onGranted: (() => void) | null;
	ask(onGranted?: () => void): void;
	/** Closes; `granted` runs the pending callback. */
	close(granted: boolean): void;
}

export const useAiConsent = create<ConsentSheetState>((set, get) => ({
	open: false,
	onGranted: null,
	ask: (onGranted) => set({ open: true, onGranted: onGranted ?? null }),
	close(granted) {
		const callback = get().onGranted;
		set({ open: false, onGranted: null });
		if (granted) callback?.();
	},
}));
