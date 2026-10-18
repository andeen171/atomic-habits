import { createSyncController, createWebStorage } from "@atomic/core";
import { store } from "./store";

/** Optional sync with a self-hosted Atomic server (Settings → Sync). */
export const syncController = createSyncController({
	store,
	sessionStorage: createWebStorage(),
});
