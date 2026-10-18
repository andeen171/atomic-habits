import { createAtomicStore, createWebStorage } from "@atomic/core";

/** The one local-first store for this device (localStorage, in-memory fallback). */
export const store = createAtomicStore({ storage: createWebStorage() });

const flush = () => {
	void store.flush();
};

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "hidden") flush();
});
window.addEventListener("pagehide", flush);
