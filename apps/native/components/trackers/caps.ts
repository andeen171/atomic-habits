import { photoStoreAvailable } from "@/lib/blob-store";
import { FEATURES, type FeatureFlag } from "@atomic/core";
import { getLocales } from "expo-localization";

/**
 * What this build can do with trackers (spec §6). Owner: T4.
 *
 * QA preview: a bundle exported with `EXPO_PUBLIC_FEATURES=templateTrackers`
 * (a comma list of `FeatureFlag`s) turns those core flags on before anything
 * reads them, so the tracker UI can be reviewed before its milestone ships
 * (the same switch as web's `VITE_FEATURES`). Release builds never set it;
 * the flags then stay as core has them. This module is imported by the
 * globally mounted entry composer, so it runs before any screen renders.
 */
const preview = String(process.env.EXPO_PUBLIC_FEATURES ?? "")
	.split(",")
	.map((flag) => flag.trim())
	.filter((flag): flag is FeatureFlag => flag in FEATURES);
for (const flag of preview) FEATURES[flag] = true;

/** This device can keep photos (the document folder; on `expo start --web`, only the QA store). */
const photoPlatform = photoStoreAvailable();

// Where photos can't work, the templates and demo habits built on them (progress photo,
// the meal log) aren't offered either (spec §1.3): the core flag follows the platform.
if (!photoPlatform) FEATURES.trackerPhotos = false;

/** Photos (milestone 4C) need the flag and a photo store on this device (spec §6). */
export function trackerCaps(): { photos: boolean } {
	return { photos: FEATURES.trackerPhotos && photoPlatform };
}

/** The device's currency ("BRL") or region ("BR") for currency defaults, or null. */
export function deviceRegion(): string | null {
	try {
		const first = getLocales()[0];
		return first?.currencyCode ?? first?.regionCode ?? null;
	} catch {
		return null;
	}
}
