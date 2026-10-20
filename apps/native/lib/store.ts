import { createAtomicStore } from "@atomic/core";
import { getLocales } from "expo-localization";
import { kv } from "./kv";

/** The device's preferred languages (BCP 47 tags), most preferred first. */
export const deviceLocales = (): readonly string[] => {
	try {
		return getLocales().map((locale) => locale.languageTag);
	} catch {
		return [];
	}
};

/**
 * The single local-first store for the app (hydrates asynchronously). It
 * keeps the expo-sqlite kv with the split layout (spec §2.6.1); the device
 * locales resolve the "system" language for new habits' `lang` and units (D44).
 */
export const store = createAtomicStore({ storage: kv, deviceLocales });
