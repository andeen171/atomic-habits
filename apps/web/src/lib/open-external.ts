import { isTauri } from "./client-info";

/**
 * Opens a page outside the app (Annex C §4): Stripe checkout and the billing
 * portal, and the account export link.
 * - Web: this tab goes there (`location.assign`); Stripe sends it back to
 *   `#/account?billing=…`.
 * - Desktop (Tauri): the system browser, through `tauri-plugin-opener`.
 *
 * Owner: T5.
 */
export async function openExternal(url: string): Promise<void> {
	if (isTauri) {
		const { openUrl } = await import("@tauri-apps/plugin-opener");
		await openUrl(url);
		return;
	}
	window.location.assign(url);
}
