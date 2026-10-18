import type { PersistStorage, StorageValue } from "zustand/middleware";

/** Minimal key/value contract: localStorage, AsyncStorage, expo-sqlite kv-store… */
export interface KeyValueStorage {
	getItem(key: string): string | null | Promise<string | null>;
	setItem(key: string, value: string): void | Promise<void>;
	removeItem(key: string): void | Promise<void>;
}

export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, value);
		},
		removeItem: (key) => {
			map.delete(key);
		},
	};
}

/**
 * Browser localStorage when it exists and works (it can throw in private
 * windows or sandboxed iframes); otherwise an in-memory fallback.
 */
export function createWebStorage(): KeyValueStorage {
	try {
		const ls = globalThis.localStorage;
		const probe = "__atomic_probe__";
		ls.setItem(probe, "1");
		ls.removeItem(probe);
		return {
			getItem: (key) => {
				try {
					return ls.getItem(key);
				} catch {
					return null;
				}
			},
			setItem: (key, value) => {
				try {
					ls.setItem(key, value);
				} catch (error) {
					console.warn("[atomic] Could not persist data", error);
				}
			},
			removeItem: (key) => {
				try {
					ls.removeItem(key);
				} catch {
					// ignore
				}
			},
		};
	} catch {
		return createMemoryStorage();
	}
}

export interface FlushablePersistStorage<S> extends PersistStorage<S> {
	/** Write any pending state immediately (call on app background / unload). */
	flush(): Promise<void>;
}

/**
 * zustand persist storage that serialises lazily: rapid taps coalesce into one
 * write. A corrupt payload is backed up instead of being silently overwritten.
 */
export function createPersistStorage<S>(
	kv: KeyValueStorage,
	{ debounceMs = 200 }: { debounceMs?: number } = {},
): FlushablePersistStorage<S> {
	let pending: { name: string; value: StorageValue<S> } | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Keys whose stored value could not be read. Writing to them would replace
	 * the user's real data with the empty state built from that failed read, so
	 * they stay read-only (in-memory) for the rest of the session.
	 */
	const unreadable = new Set<string>();

	const write = async () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (!pending) return;
		const { name, value } = pending;
		pending = null;
		if (unreadable.has(name)) return;
		try {
			await kv.setItem(name, JSON.stringify(value));
		} catch (error) {
			console.warn("[atomic] Could not persist data", error);
		}
	};

	const parse = (name: string, raw: string | null): StorageValue<S> | null => {
		if (!raw) return null;
		try {
			return JSON.parse(raw) as StorageValue<S>;
		} catch {
			try {
				void Promise.resolve(kv.setItem(`${name}:corrupt:${Date.now()}`, raw)).catch(() => {});
			} catch {
				// best effort
			}
			return null;
		}
	};

	return {
		// Stays synchronous for synchronous backends (localStorage) so the
		// first render already has the user's data.
		getItem(name) {
			const fail = (error: unknown) => {
				unreadable.add(name);
				console.warn("[atomic] Could not read stored data; changes stay in memory", error);
				return null;
			};
			let raw: string | null | Promise<string | null>;
			try {
				raw = kv.getItem(name);
			} catch (error) {
				return fail(error);
			}
			if (raw && typeof (raw as Promise<string | null>).then === "function") {
				return (raw as Promise<string | null>).then((value) => parse(name, value), fail);
			}
			return parse(name, raw as string | null);
		},
		setItem(name, value) {
			if (unreadable.has(name)) return;
			pending = { name, value };
			if (debounceMs <= 0) {
				void write();
				return;
			}
			if (!timer) timer = setTimeout(() => void write(), debounceMs);
		},
		async removeItem(name) {
			pending = null;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			try {
				await kv.removeItem(name);
			} catch {
				// ignore
			}
		},
		flush: write,
	};
}
