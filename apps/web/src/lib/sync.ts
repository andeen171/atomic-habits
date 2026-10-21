import { createSyncController, createWebStorage, normalizeServerUrl } from "@atomic/core";
import { blobStore } from "./blob-store";
import { clientHeaders, deviceLabel } from "./client-info";
import { isArtifactBuild } from "./runtime";
import { store } from "./store";

/**
 * Account sync for this device (spec §2.7, §5.9; Annex C §1.3, §4).
 * - The official server ("Atomic Cloud") comes from the build
 *   (`VITE_SERVER_URL`); `settings.serverUrl` overrides it ("Advanced ·
 *   self-hosting"). A build without one asks for a URL.
 * - Every request says who is asking (`X-Atomic-Client`, `X-Atomic-Locale`)
 *   and sign-in sends the device label shown in the account's device list.
 * - Photos (D23) back up from the IndexedDB photo store, where this browser
 *   can keep photos at all.
 * - Coming back online retries at once instead of waiting for the backoff.
 *
 * The artifact build never starts it (spec §1.3). Owner: T5.
 */

const configured = String(import.meta.env.VITE_SERVER_URL ?? "").trim();

/** The build's official server, normalized; null in builds without one. */
export const officialServerUrl: string | null = configured ? normalizeServerUrl(configured) : null;

const photosPossible =
	!isArtifactBuild &&
	typeof indexedDB !== "undefined" &&
	typeof crypto !== "undefined" &&
	!!crypto.subtle;

export const syncController = createSyncController({
	store,
	sessionStorage: createWebStorage(),
	defaultServerUrl: officialServerUrl,
	clientHeaders,
	device: deviceLabel,
	blobs: photosPossible ? { store: blobStore } : null,
});

if (!isArtifactBuild && typeof window !== "undefined") {
	window.addEventListener("online", () => syncController.notifyOnline());
}
