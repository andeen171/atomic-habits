import { useHydrated } from "@atomic/core/react";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useNotificationRouting, useReminderSync } from "./reminders";
import { store } from "./store";
import { syncController } from "./sync";

/**
 * App-wide side effects once the store is hydrated: persist on background,
 * start sync, keep reminders scheduled and route notification taps.
 */
export function useAppLifecycle() {
	const hydrated = useHydrated();

	useEffect(() => {
		const sub = AppState.addEventListener("change", (state) => {
			if (state !== "active") void store.flush();
		});
		return () => sub.remove();
	}, []);

	useEffect(() => {
		if (!hydrated) return;
		syncController.start().catch((error) => console.warn("[atomic] Sync start failed", error));
		return () => syncController.stop();
	}, [hydrated]);

	useReminderSync();
	useNotificationRouting();
}
