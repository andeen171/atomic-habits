import { finishBilling } from "@/lib/account";
import { billingResultOf } from "@/lib/open-external";

/**
 * Incoming links (expo-router `+native-intent`). Stripe's return page opens
 * `atomic://billing?result=success|cancel|portal` (Annex C §1.5): that is not
 * a screen, so it is handled here (`finishBilling` confirms the plan, says
 * nothing was charged, or refreshes) instead of landing on "not found".
 * Opened from a cold start it lands on the Account screen; while the app is
 * running (the checkout's auth session handing back) it stays where it is.
 * Every other link passes through unchanged. Owner: T5.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
	try {
		const result = billingResultOf(path);
		if (!result) return path;
		void finishBilling(result);
		return initial ? "/account" : null;
	} catch {
		return initial ? "/" : path;
	}
}
