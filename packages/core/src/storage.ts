import type { PersistStorage, StorageValue } from "zustand/middleware";

/**
 * Key/value backends for local persistence (spec §2.6.1).
 *
 * - Web, desktop and the artifact: `createIndexedDbStorage()`, which falls
 *   back to localStorage and then to memory when IndexedDB is unavailable
 *   (private mode, sandboxed iframes).
 * - Native: the expo-sqlite kv store, adapted in the app.
 * - Tests: `createMemoryStorage()`.
 *
 * Write failures are thrown (or rejected), never swallowed here: the
 * persistence layer (`persist-layout.ts`) reports them as `persistError`.
 */

/** Minimal key/value contract: localStorage, IndexedDB, expo-sqlite kv-store… */
export interface KeyValueStorage {
	getItem(key: string): string | null | Promise<string | null>;
	setItem(key: string, value: string): void | Promise<void>;
	removeItem(key: string): void | Promise<void>;
	/** Every stored key that starts with `prefix`. Optional; used to find layout slices. */
	keys?(prefix: string): Promise<string[]>;
}

export type StorageBackend = "indexedDB" | "localStorage" | "memory";

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
		keys: async (prefix) => [...map.keys()].filter((key) => key.startsWith(prefix)),
	};
}

/** The browser's localStorage, or null when it is missing or throws (private windows, sandboxes). */
function openLocalStorage(): KeyValueStorage | null {
	try {
		const ls = globalThis.localStorage;
		if (!ls) return null;
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
			// Throws on failure (QuotaExceededError…): the caller reports it.
			setItem: (key, value) => {
				ls.setItem(key, value);
			},
			removeItem: (key) => {
				try {
					ls.removeItem(key);
				} catch {
					// ignore
				}
			},
			keys: async (prefix) => {
				const out: string[] = [];
				for (let i = 0; i < ls.length; i++) {
					const key = ls.key(i);
					if (key?.startsWith(prefix)) out.push(key);
				}
				return out;
			},
		};
	} catch {
		return null;
	}
}

/**
 * Browser localStorage when it exists and works; otherwise an in-memory
 * fallback. `setItem` throws when the browser refuses the write (quota), so
 * the persistence layer can report it instead of losing data silently.
 */
export function createWebStorage(): KeyValueStorage {
	return openLocalStorage() ?? createMemoryStorage();
}

export interface IndexedDbStorageOptions {
	/** Database name. Default "atomic-habits". */
	db?: string;
	/** Object store name. Default "kv". */
	store?: string;
	/** IndexedDB factory; defaults to `globalThis.indexedDB` (tests pass fake-indexeddb). */
	indexedDB?: IDBFactory | null;
	/**
	 * The localStorage-backed storage: the fallback when IndexedDB can't be
	 * opened, and the source of the one-time migration when it can. Defaults to
	 * the browser's localStorage (memory when that is unavailable too).
	 */
	localStorage?: KeyValueStorage | null;
	/** Give up on IndexedDB when opening takes longer than this. Default 4 s. */
	openTimeoutMs?: number;
}

/** A storage that knows its backend and, on IndexedDB, the older localStorage store to migrate from. */
export interface MigratingStorage extends KeyValueStorage {
	keys(prefix: string): Promise<string[]>;
	/** The backend in use (resolves once IndexedDB was opened or given up on). */
	backend(): Promise<StorageBackend>;
	/** The localStorage store data was kept in before IndexedDB; null unless the backend is IndexedDB. */
	legacy(): Promise<KeyValueStorage | null>;
}

export function isMigratingStorage(kv: KeyValueStorage): kv is MigratingStorage {
	return typeof (kv as Partial<MigratingStorage>).legacy === "function";
}

function openDatabase(
	factory: IDBFactory,
	name: string,
	store: string,
	timeoutMs: number,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new Error("IndexedDB open timed out"));
		}, timeoutMs);
		const done = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};
		let request: IDBOpenDBRequest;
		try {
			request = factory.open(name, 1);
		} catch (error) {
			done(() => reject(error));
			return;
		}
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
		};
		request.onsuccess = () => {
			const db = request.result;
			if (settled) {
				db.close();
				return;
			}
			done(() => resolve(db));
		};
		request.onerror = () => done(() => reject(request.error ?? new Error("IndexedDB open failed")));
		request.onblocked = () => {
			// Another tab holds an older version open; keep waiting for the timeout.
		};
	});
}

type Opened =
	| { kind: "indexedDB"; db: IDBDatabase }
	| { kind: "localStorage" | "memory"; kv: KeyValueStorage };

interface WriteOp {
	key: string;
	value: string | null;
	resolve: () => void;
	reject: (error: unknown) => void;
}

/**
 * Key/value storage in IndexedDB (`{ db: "atomic-habits", store: "kv" }`).
 *
 * - Values are strings, as with every `KeyValueStorage`.
 * - Writes issued in the same tick share one readwrite transaction, so a
 *   persistence flush (main key, meta key, slices) lands atomically.
 * - Reads and writes run in the order they were issued.
 * - When IndexedDB is missing or can't be opened, it falls back to
 *   localStorage, then to memory.
 */
export function createIndexedDbStorage(options: IndexedDbStorageOptions = {}): MigratingStorage {
	const dbName = options.db ?? "atomic-habits";
	const storeName = options.store ?? "kv";
	const factory =
		options.indexedDB !== undefined
			? options.indexedDB
			: ((globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null);
	const local = options.localStorage !== undefined ? options.localStorage : openLocalStorage();
	const timeoutMs = options.openTimeoutMs ?? 4000;

	let opened: Promise<Opened> | null = null;
	const open = (): Promise<Opened> => {
		opened ??= (
			factory
				? openDatabase(factory, dbName, storeName, timeoutMs)
				: Promise.reject(new Error("IndexedDB is unavailable"))
		).then(
			(db): Opened => ({ kind: "indexedDB", db }),
			(error): Opened => {
				if (factory) console.warn("[atomic] IndexedDB unavailable; using fallback storage", error);
				return local
					? { kind: "localStorage", kv: local }
					: { kind: "memory", kv: createMemoryStorage() };
			},
		);
		return opened;
	};

	let batch: WriteOp[] | null = null;

	const runBatch = async (ops: WriteOp[]) => {
		let target: Opened;
		try {
			target = await open();
		} catch (error) {
			for (const op of ops) op.reject(error);
			return;
		}
		if (target.kind !== "indexedDB") {
			// Issued synchronously and in order, so a later read sees them.
			for (const op of ops) {
				try {
					const result =
						op.value === null ? target.kv.removeItem(op.key) : target.kv.setItem(op.key, op.value);
					if (result && typeof (result as Promise<void>).then === "function") {
						(result as Promise<void>).then(op.resolve, op.reject);
					} else {
						op.resolve();
					}
				} catch (error) {
					op.reject(error);
				}
			}
			return;
		}
		let tx: IDBTransaction | null = null;
		try {
			tx = target.db.transaction(storeName, "readwrite");
			const store = tx.objectStore(storeName);
			for (const op of ops) {
				if (op.value === null) store.delete(op.key);
				else store.put(op.value, op.key);
			}
			const current = tx;
			current.oncomplete = () => {
				for (const op of ops) op.resolve();
			};
			const fail = () => {
				const error = current.error ?? new Error("IndexedDB write failed");
				for (const op of ops) op.reject(error);
			};
			current.onerror = fail;
			current.onabort = fail;
		} catch (error) {
			try {
				tx?.abort();
			} catch {
				// already finished
			}
			for (const op of ops) op.reject(error);
		}
	};

	/** Starts the pending batch now, so a later read is ordered after it. */
	const startBatch = () => {
		const ops = batch;
		batch = null;
		if (ops?.length) void runBatch(ops);
	};

	const write = (key: string, value: string | null): Promise<void> =>
		new Promise((resolve, reject) => {
			if (!batch) {
				batch = [];
				queueMicrotask(startBatch);
			}
			batch.push({ key, value, resolve, reject });
		});

	const read = async <T>(fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
		startBatch();
		const target = await open();
		if (target.kind !== "indexedDB") throw new Error("not indexedDB");
		return new Promise<T>((resolve, reject) => {
			try {
				const request = fn(target.db.transaction(storeName, "readonly").objectStore(storeName));
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
			} catch (error) {
				reject(error);
			}
		});
	};

	return {
		async getItem(key) {
			startBatch();
			const target = await open();
			if (target.kind !== "indexedDB") return target.kv.getItem(key);
			const value = await read((store) => store.get(key));
			return typeof value === "string" ? value : null;
		},
		setItem: (key, value) => write(key, value),
		removeItem: (key) => write(key, null),
		async keys(prefix) {
			startBatch();
			const target = await open();
			if (target.kind !== "indexedDB") return (await target.kv.keys?.(prefix)) ?? [];
			const all = await read((store) => store.getAllKeys());
			return all.filter((k): k is string => typeof k === "string" && k.startsWith(prefix));
		},
		backend: async () => (await open()).kind,
		legacy: async () => ((await open()).kind === "indexedDB" ? local : null),
	};
}

/** Asks the browser to keep this origin's storage under pressure (best effort; web only). */
export async function requestPersistentStorage(): Promise<boolean> {
	try {
		const storage = (
			globalThis as { navigator?: { storage?: { persist?: () => Promise<boolean> } } }
		).navigator?.storage;
		return storage?.persist ? await storage.persist() : false;
	} catch {
		return false;
	}
}

export interface FlushablePersistStorage<S> extends PersistStorage<S> {
	/** Write any pending state immediately (call on app background / unload). */
	flush(): Promise<void>;
}

/**
 * Single-key zustand persist storage (v1 layout) that serialises lazily: rapid
 * taps coalesce into one write. A corrupt payload is backed up instead of
 * being silently overwritten. The store itself uses the split layout
 * (`createSplitStorage` in `persist-layout.ts`).
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
