import { BILLING_DEEP_LINK, BILLING_RESULTS, type BillingResult, toDayKey } from "@atomic/core";
import { palettes } from "@atomic/core/theme";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { Appearance, Linking, Platform } from "react-native";
import { store } from "./store";

/**
 * Pages outside the app (Annex C §1.5, §5):
 * - the billing portal and other links: the in-app browser (Custom Tabs /
 *   SFSafariViewController), tinted like the app;
 * - Stripe checkout: an auth session that closes itself when the server's
 *   return page opens `atomic://billing?result=…`;
 * - the account export (D69): the single-use link is downloaded to the
 *   cache and handed to the share sheet ("Save to Files", Drive, mail…).
 *
 * The `expo start --web` QA export opens a new tab instead. Owner: T5.
 */

const isWeb = Platform.OS === "web";

/** The in-app browser's toolbar in the app's colors (light or dark, as the app shows now). */
function tint(): { toolbarColor: string; controlsColor: string } {
	const setting = store.getState().settings.theme;
	const scheme =
		setting === "system" ? (Appearance.getColorScheme() === "dark" ? "dark" : "light") : setting;
	const palette = palettes[scheme];
	return { toolbarColor: palette.bg, controlsColor: palette.accentText };
}

/** Opens a page in the in-app browser (a new tab on web). */
export async function openExternal(url: string): Promise<void> {
	if (isWeb) {
		globalThis.open?.(url, "_blank", "noopener");
		return;
	}
	try {
		await WebBrowser.openBrowserAsync(url, {
			...tint(),
			enableBarCollapsing: true,
			showTitle: true,
		});
	} catch {
		// No browser that supports Custom Tabs: hand it to the system.
		await Linking.openURL(url);
	}
}

/** How a checkout session ended: Stripe's result, or closed by hand ("dismissed"). */
export type CheckoutOutcome = BillingResult | "dismissed";

/** The `result` of an `atomic://billing?result=…` link, or null. */
export function billingResultOf(url: string | null | undefined): BillingResult | null {
	if (!url) return null;
	const [path = ""] = url.split(/[?#]/);
	if (!/(^|[:/])billing\/?$/i.test(path)) return null;
	const match = /[?&]result=([a-z-]+)/i.exec(url);
	const value = match?.[1]?.toLowerCase();
	return value && (BILLING_RESULTS as readonly string[]).includes(value)
		? (value as BillingResult)
		: null;
}

/**
 * Stripe checkout or the billing portal in an auth session: resolves when
 * the browser comes back to `atomic://billing` or the person closes it.
 */
export async function openBillingSession(url: string): Promise<CheckoutOutcome> {
	if (isWeb) {
		globalThis.open?.(url, "_blank", "noopener");
		return "dismissed";
	}
	try {
		const result = await WebBrowser.openAuthSessionAsync(url, BILLING_DEEP_LINK, {
			...tint(),
			showTitle: true,
		});
		if (result.type === "success") return billingResultOf(result.url) ?? "dismissed";
		return "dismissed";
	} catch {
		await Linking.openURL(url);
		return "dismissed";
	}
}

/**
 * The account archive (Annex C §1.1, D69): downloads the single-use link to
 * the cache and opens the share sheet. Falls back to the browser when this
 * device can't share files.
 */
export async function saveAccountExport(url: string): Promise<void> {
	if (isWeb) {
		globalThis.open?.(url, "_blank", "noopener");
		return;
	}
	if (!(await Sharing.isAvailableAsync())) {
		await Linking.openURL(url);
		return;
	}
	const target = new File(Paths.cache, `atomic-account-${toDayKey()}.zip`);
	if (target.exists) target.delete();
	const file = await File.downloadFileAsync(url, target);
	await Sharing.shareAsync(file.uri, {
		mimeType: "application/zip",
		UTI: "public.zip-archive",
	});
}
