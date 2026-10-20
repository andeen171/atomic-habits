import { watchTrackerDays } from "@atomic/core";
import { useHydrated, useI18n } from "@atomic/core/react";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { haptics } from "./haptics";
import { useNotificationRouting, useReminderSync } from "./reminders";
import { store } from "./store";
import { syncController } from "./sync";
import { showToast } from "./ui-store";

/**
 * App-wide side effects once the store is hydrated: persist on background,
 * start sync, reconcile tracker days at day change, surface store notices,
 * keep reminders scheduled and route notification taps.
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
		// App start is reconciled by the store after hydration; this covers the
		// local day rolling over while the app runs (spec §3.1, D21).
		const stopDays = watchTrackerDays(store);
		return () => {
			stopDays();
			syncController.stop();
		};
	}, [hydrated]);

	useStoreNotices();
	useReminderSync();
	useNotificationRouting();
}

/**
 * Store notices (spec §2.6.5, §2.7): a local edit refused because a newer
 * version of Atomic wrote the document gets a toast. A failed write needs
 * nothing here: the blocking banner in `CloudBanners` reads `persistError`
 * (and every failed write emits a notice, which would repeat a toast).
 */
function useStoreNotices() {
	const t = useI18n();
	const translator = useRef(t);
	translator.current = t;
	useEffect(
		() =>
			store.subscribeNotices((notice) => {
				if (notice.type !== "superseded") return;
				haptics.warning();
				showToast(translator.current.t("sync.superseded"), { tone: "danger", duration: 6000 });
			}),
		[],
	);
}
