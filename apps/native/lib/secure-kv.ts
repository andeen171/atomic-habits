import type { KeyValueStorage } from "@atomic/core";
import * as SecureStore from "expo-secure-store";

/** Keychain / Keystore backed storage for the sync session token. */
export const secureKv: KeyValueStorage = {
	getItem: (key) => SecureStore.getItemAsync(key),
	setItem: (key, value) => SecureStore.setItemAsync(key, value),
	removeItem: (key) => SecureStore.deleteItemAsync(key),
};
