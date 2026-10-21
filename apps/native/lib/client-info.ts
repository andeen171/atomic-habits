import { type BillingClient, type Locale, atomicClientHeaders, resolveLocale } from "@atomic/core";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { deviceLocales, store } from "./store";

/**
 * Who this client is, for the server (Annex C §1.1, §5):
 * - `X-Atomic-Client` (`android/2.0.0`, `ios/2.0.0`; the `expo start --web`
 *   QA export says `web`) and `X-Atomic-Locale` (the resolved app locale:
 *   emails and server pages follow it) on every request;
 * - `X-Atomic-Device` at sign-in, the label the account's device list shows
 *   ("Atomic Android · Google Pixel 8"). It is percent-encoded, which the
 *   server decodes (header values are bytes).
 *
 * Owner: T5.
 */

/** The app version (`app.json`), as the update banner compares it. */
export const appVersion: string = Constants.expoConfig?.version ?? "1.0.0";

/** Native checkout comes back through `atomic://billing` (Annex C §1.5). */
export const billingClient: BillingClient = "native";

const client = Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "web";

/** The resolved app locale right now (the setting, else the device's languages). */
export function appLocale(): Locale {
	return resolveLocale(store.getState().settings.locale, deviceLocales());
}

export function clientHeaders(): Record<string, string> {
	return atomicClientHeaders({ locale: appLocale(), client, version: appVersion });
}

const clean = (value: unknown): string =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/** "Google Pixel 8", "samsung SM-S911B" → "Samsung SM-S911B"; null when unknown. */
function androidModel(): string | null {
	const constants = Platform.constants as unknown as Record<string, unknown>;
	const brand = clean(constants.Brand) || clean(constants.Manufacturer);
	const model = clean(constants.Model);
	if (!model) return brand ? capitalizeWord(brand) : null;
	// Many models already start with the brand ("Pixel 8" doesn't, "Redmi Note 12" does).
	if (!brand || model.toLowerCase().startsWith(brand.toLowerCase())) return model;
	return `${capitalizeWord(brand)} ${model}`;
}

const capitalizeWord = (word: string) => word.charAt(0).toLocaleUpperCase() + word.slice(1);

/**
 * The device label sent at sign-in (`X-Atomic-Device`), percent-encoded and
 * language-neutral (every device of the account shows it).
 */
export function deviceLabel(): string {
	if (Platform.OS === "android") {
		const model = androidModel();
		return encodeURIComponent(model ? `Atomic Android · ${model}` : "Atomic Android");
	}
	if (Platform.OS === "ios") {
		const constants = Platform.constants as unknown as Record<string, unknown>;
		const idiom = clean(constants.interfaceIdiom);
		return encodeURIComponent(idiom === "pad" ? "Atomic iOS · iPad" : "Atomic iOS · iPhone");
	}
	return encodeURIComponent("Atomic Web");
}
