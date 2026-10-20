import {
	type AtomicStore,
	createAtomicStore,
	createIndexedDbStorage,
	requestPersistentStorage,
} from "@atomic/core";
import { isArtifactBuild } from "./runtime";

/**
 * The one local-first store for this device (spec §2.6):
 * - IndexedDB (`atomic-habits` / `kv`) with the split layout, falling back
 *   to localStorage and then to memory (private mode, sandboxed iframes);
 * - the v1 localStorage key is migrated once, and merged again if a stale
 *   v1 tab writes it later;
 * - tabs merge each other's writes over `BroadcastChannel("atomic-habits")`;
 * - a failed write sets `persistError` (blocking banner, `CloudBanners`).
 */
export const store: AtomicStore = createAtomicStore({
	storage: createIndexedDbStorage({ db: "atomic-habits", store: "kv" }),
	crossTab: true,
});

/** Runs `fn` once the persisted state has been loaded. */
export function whenHydrated(fn: () => void): void {
	if (store.getState().hydrated) {
		fn();
		return;
	}
	const unsubscribe = store.subscribe((state) => {
		if (!state.hydrated) return;
		unsubscribe();
		fn();
	});
}

const PERSIST_ASKED_KEY = "atomic-habits:persist-requested";

/**
 * Asks the browser to keep this origin's data under storage pressure, once
 * per device and only after hydration (best effort, spec §2.6.1). Skipped in
 * the artifact iframe, whose storage the host owns.
 */
function askPersistence(): void {
	if (isArtifactBuild) return;
	try {
		if (localStorage.getItem(PERSIST_ASKED_KEY)) return;
		localStorage.setItem(PERSIST_ASKED_KEY, "1");
	} catch {
		// No localStorage: ask anyway (the browser remembers the answer).
	}
	void (async () => {
		try {
			if (await navigator.storage?.persisted?.()) return;
		} catch {
			// unsupported
		}
		await requestPersistentStorage();
	})();
}

whenHydrated(askPersistence);

const flush = () => {
	void store.flush();
};

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "hidden") flush();
});
window.addEventListener("pagehide", flush);
