import type { KeyValueStorage } from "@atomic/core";
import Storage from "expo-sqlite/kv-store";

/** Durable key/value storage for the store, backed by SQLite on device. */
export const kv: KeyValueStorage = {
	getItem: (key) => Storage.getItemAsync(key),
	setItem: (key, value) => Storage.setItemAsync(key, value),
	removeItem: async (key) => {
		await Storage.removeItemAsync(key);
	},
};
