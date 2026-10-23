import type { KeyValueStorage } from "@atomic/core";
import Storage from "expo-sqlite/kv-store";

/**
 * Durable key/value storage for the store, backed by SQLite on device.
 * Write failures reject (never swallowed): the persistence layer reports
 * them as `persistError` (spec §2.6.5).
 */
export const kv: KeyValueStorage = {
	getItem: (key) => Storage.getItemAsync(key),
	setItem: (key, value) => Storage.setItemAsync(key, value),
	removeItem: async (key) => {
		await Storage.removeItemAsync(key);
	},
	// Finds the split-layout slices (`atomic-habits:c:*`, spec §2.6.2).
	keys: async (prefix) => (await Storage.getAllKeysAsync()).filter((key) => key.startsWith(prefix)),
};
