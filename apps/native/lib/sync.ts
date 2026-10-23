import { createSyncController, normalizeServerUrl } from "@atomic/core";
import { Platform } from "react-native";
import { blobStore, photoStoreAvailable } from "./blob-store";
import { nativeBlobTransport } from "./blob-transport";
import { appVersion, clientHeaders, deviceLabel } from "./client-info";
import { secureKv } from "./secure-kv";
import { store } from "./store";

/**
 * Account sync for this device (spec §2.7, §6; Annex C §1.3, §5).
 * - The official server ("Atomic Cloud") comes from the build
 *   (`EXPO_PUBLIC_SERVER_URL`); `settings.serverUrl` overrides it
 *   ("Advanced · self-hosting"). A build without one asks for a URL.
 * - Every request says who is asking (`X-Atomic-Client`, `X-Atomic-Locale`)
 *   and sign-in sends the device label shown in the account's device list.
 * - The session token lives in the Keychain / Keystore.
 * - Android compares the app with the server's latest sideloaded build
 *   (`updateAvailable`, the "Update available" banner).
 * - Coming back to the app retries at once (`lib/lifecycle.ts`).
 * - Photos (D23) back up from the device's photo store (`lib/blob-store.ts`,
 *   T4) through the file-system transport (`lib/blob-transport.ts`), where
 *   this device can keep photos at all.
 * Owner: T5.
 */

const configured = String(process.env.EXPO_PUBLIC_SERVER_URL ?? "").trim();

/** The build's official server, normalized; null in builds without one. */
export const officialServerUrl: string | null = configured ? normalizeServerUrl(configured) : null;

export const syncController = createSyncController({
	store,
	sessionStorage: secureKv,
	defaultServerUrl: officialServerUrl,
	clientHeaders,
	device: deviceLabel,
	updateCheck: Platform.OS === "android" ? { platform: "android", version: appVersion } : null,
	blobs: photoStoreAvailable() ? { store: blobStore, transport: nativeBlobTransport } : null,
});
