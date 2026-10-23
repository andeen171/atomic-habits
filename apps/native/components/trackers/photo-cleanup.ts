import { blobStore } from "@/lib/blob-store";
import { store } from "@/lib/store";
import { pruneLocalBlobs } from "@atomic/core";
import { deviceStorage } from "./device-storage";

/**
 * Local clean-up of photos (D23, Annex K §1.11): deletes photos no entry
 * references any more (a picked photo whose entry was never saved, entries
 * deleted over 30 days ago), keeping anything younger than 24 h. At most
 * daily, at idle, once the data has loaded. When blob sync is wired it does
 * the same; both are safe together. Owner: T4.
 */

const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const PRUNE_KEY = "atomic-habits:blobs-pruned-at";

let scheduled = false;

export function scheduleBlobCleanup(): void {
	if (scheduled) return;
	scheduled = true;
	const last = Number(deviceStorage.get(PRUNE_KEY));
	if (last > 0 && Date.now() - last < PRUNE_EVERY_MS) return;
	const go = () => {
		void pruneLocalBlobs(store, blobStore)
			.then(() => deviceStorage.set(PRUNE_KEY, String(Date.now())))
			.catch((error: unknown) => console.warn("[atomic] Could not clean up local photos", error));
	};
	// Well after start-up, when the app is idle: never in the way of the first screens.
	const run = () =>
		setTimeout(() => {
			const idle = (globalThis as { requestIdleCallback?: (fn: () => void) => void })
				.requestIdleCallback;
			if (idle) idle(go);
			else go();
		}, 5_000);
	if (store.getState().hydrated) run();
	else {
		const unsubscribe = store.subscribe((state) => {
			if (!state.hydrated) return;
			unsubscribe();
			run();
		});
	}
}
