import { type KeyValueStorage, createWebStorage } from "@atomic/core";

/** localStorage on web previews (memory fallback when unavailable). */
export const kv: KeyValueStorage = createWebStorage();
