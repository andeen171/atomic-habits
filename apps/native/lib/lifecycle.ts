import { watchTrackerDays } from "@atomic/core";
import { useHydrated, useI18n } from "@atomic/core/react";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { refreshOnReturn } from "./account";
import { startAi } from "./ai";
import { haptics } from "./haptics";
import { useNotificationRouting, useReminderSync } from "./reminders";
import { store } from "./store";
import { syncController } from "./sync";
import { showToast } from "./ui-store";

/**
 * App-wide side effects once the store is hydrated: persist on background,
 * start sync, reconcile tracker days at day change, surface store notices,
 * keep reminders scheduled and route notification taps.
 *
 * Coming back to the foreground retries sync at once (instead of waiting
 * for the backoff) and refreshes the account at most once a minute (at
 * once while the email waits for confirmation), so a confirmed email or a
 * plan bought elsewhere shows up (Annex C §1.3, §5).
 * Billing links (`atomic://billing`) are handled in `app/+native-intent.tsx`.
 * The AI client's translation runner starts with sync (`lib/ai.ts`).
 */
export function useAppLifecycle() {
	const hydrated = useHydrated();

	useEffect(() => {
		const sub = AppState.addEventListener("change", (state) => {
			if (state !== "active") {
				void store.flush();
				return;
			}
			syncController.notifyOnline();
			refreshOnReturn();
		});
		return () => sub.remove();
	}, []);

	useEffect(() => {
		if (!hydrated) return;
		syncController.start().catch((error) => console.warn("[atomic] Sync start failed", error));
		// AI translations of the user's text, when the account turned them on (Annex C §1.8).
		startAi();
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
