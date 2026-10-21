import { isArtifactBuild } from "@/lib/runtime";
import { FEATURES, type FeatureFlag } from "@atomic/core";

/**
 * What this build can do with trackers (spec §5.8). Owner: T4.
 *
 * QA preview: a build made with `VITE_FEATURES=templateTrackers` (a comma
 * list of `FeatureFlag`s) turns those core flags on before anything reads
 * them, so the tracker UI can be reviewed before its milestone ships. The
 * variable is never set for releases; the flags then stay as core has them.
 */
const preview = String(import.meta.env.VITE_FEATURES ?? "")
	.split(",")
	.map((flag) => flag.trim())
	.filter((flag): flag is FeatureFlag => flag in FEATURES);
for (const flag of preview) FEATURES[flag] = true;

/**
 * Photos need the 4C flag, IndexedDB and WebCrypto, and never ship in the
 * artifact build (spec §1.3, §5.8).
 */
export function trackerCaps(): { photos: boolean } {
	return {
		photos:
			FEATURES.trackerPhotos &&
			!isArtifactBuild &&
			typeof indexedDB !== "undefined" &&
			typeof crypto !== "undefined" &&
			!!crypto.subtle,
	};
}

/** The device's region for currency defaults ("BR" from "pt-BR"), or null. */
export function deviceRegion(): string | null {
	if (typeof navigator === "undefined") return null;
	for (const tag of navigator.languages ?? [navigator.language]) {
		const region = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(tag ?? "")?.[1];
		if (region) return region.toUpperCase();
	}
	return null;
}
