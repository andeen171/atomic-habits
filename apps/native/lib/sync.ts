import { createSyncController } from "@atomic/core";
import { secureKv } from "./secure-kv";
import { store } from "./store";

/** Optional sync with a self-hosted Atomic server (session in secure storage). */
export const syncController = createSyncController({ store, sessionStorage: secureKv });

/** Default server URL for the sign-in form (`EXPO_PUBLIC_SERVER_URL`). */
export const defaultServerUrl = process.env.EXPO_PUBLIC_SERVER_URL ?? "";
