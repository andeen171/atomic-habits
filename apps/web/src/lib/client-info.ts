import { type BillingClient, type Locale, atomicClientHeaders, resolveLocale } from "@atomic/core";
import { store } from "./store";

/**
 * Who this client is, for the server (Annex C §1.1, §4):
 * - `X-Atomic-Client` (`web/2.0.0`, `desktop/2.0.0`) and `X-Atomic-Locale`
 *   (the resolved app locale: emails and server pages follow it) on every
 *   request;
 * - `X-Atomic-Device` at sign-in, the label the account's device list shows
 *   ("Atomic Web · Chrome (macOS)", "Atomic Desktop · Windows"). It is
 *   percent-encoded, which the server decodes (header values are bytes).
 *
 * Owner: T5.
 */

/** Running inside the Tauri desktop shell (its webview injects this global). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Who opened checkout: decides where Stripe's return page sends the browser. */
export const billingClient: BillingClient = isTauri ? "desktop" : "web";

/** The resolved app locale right now (the setting, else the browser's languages). */
export function appLocale(): Locale {
	const languages = typeof navigator === "undefined" ? [] : (navigator.languages ?? []);
	return resolveLocale(store.getState().settings.locale, languages);
}

export function clientHeaders(): Record<string, string> {
	return atomicClientHeaders({
		locale: appLocale(),
		client: isTauri ? "desktop" : "web",
		version: __APP_VERSION__,
	});
}

interface UADataLike {
	platform?: string;
	brands?: { brand: string }[];
}

const BROWSERS: [RegExp, string][] = [
	[/Edg(e|A|iOS)?\//, "Edge"],
	[/OPR\/|Opera/, "Opera"],
	[/SamsungBrowser\//, "Samsung Internet"],
	[/Firefox\/|FxiOS\//, "Firefox"],
	[/CriOS\/|Chrome\//, "Chrome"],
	[/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
	[/Windows/, "Windows"],
	[/iPhone|iPod/, "iPhone"],
	[/iPad/, "iPad"],
	[/Android/, "Android"],
	[/CrOS/, "ChromeOS"],
	[/Mac OS X|Macintosh/, "macOS"],
	[/Linux/, "Linux"],
];

const match = (value: string, table: [RegExp, string][]) =>
	table.find(([pattern]) => pattern.test(value))?.[1] ?? null;

/**
 * "Chrome (macOS)", "Safari (iPhone)": language-neutral, since every device
 * of the account shows it. Null when nothing is recognised.
 */
export function describeBrowser(userAgent: string, data?: UADataLike | null): string | null {
	let system = match(userAgent, SYSTEMS);
	const platform = data?.platform?.trim();
	if (platform) system = platform === "macOS" || platform === "Windows" ? platform : system;
	// Brand hints first (they don't pretend to be every other browser).
	const hinted = data?.brands
		?.map((b) => b.brand)
		.find((brand) => /Edge|Opera|Chrome|Brave|Vivaldi/i.test(brand) && !/Chromium/i.test(brand));
	const browser = hinted?.replace(/^Microsoft\s+|^Google\s+/, "") ?? match(userAgent, BROWSERS);
	if (browser && system) return `${browser} (${system})`;
	return browser ?? system;
}

/** The device label sent at sign-in (`X-Atomic-Device`), percent-encoded. */
export function deviceLabel(): string {
	if (typeof navigator === "undefined") return "Atomic";
	const nav = navigator as Navigator & { userAgentData?: UADataLike };
	if (isTauri) {
		const system = match(nav.userAgent, SYSTEMS);
		return encodeURIComponent(system ? `Atomic Desktop · ${system}` : "Atomic Desktop");
	}
	const described = describeBrowser(nav.userAgent, nav.userAgentData);
	const label = described ? `Atomic Web · ${described}` : "Atomic Web";
	return encodeURIComponent(label);
}
