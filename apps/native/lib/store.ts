import { createAtomicStore } from "@atomic/core";
import { kv } from "./kv";

/** The single local-first store for the app (hydrates asynchronously). */
export const store = createAtomicStore({ storage: kv });
