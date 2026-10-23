import Storage from "expo-sqlite/kv-store";

/**
 * Small, synchronous device storage for the trackers (Annex K §5.2): the
 * running timer, writing-pad drafts and per-device preferences. It is the
 * same SQLite key/value store as `lib/kv.ts`, read and written synchronously
 * so a timer or a draft is never a frame behind, and nothing in it is ever
 * synced. Every call is guarded: a failing write keeps the value in memory
 * for this run. `device-storage.web.ts` is the localStorage twin for
 * `expo start --web`. Owner: T4.
 */
export const deviceStorage = {
	get(key: string): string | null {
		try {
			return Storage.getItemSync(key);
		} catch {
			return null;
		}
	},
	set(key: string, value: string): boolean {
		try {
			Storage.setItemSync(key, value);
			return true;
		} catch {
			return false;
		}
	},
	remove(key: string): void {
		try {
			Storage.removeItemSync(key);
		} catch {
			// Nothing to clean up.
		}
	},
	/** Keys that start with `prefix` (drafts to prune). */
	keys(prefix: string): string[] {
		try {
			return Storage.getAllKeysSync().filter((key) => key.startsWith(prefix));
		} catch {
			return [];
		}
	},
};
