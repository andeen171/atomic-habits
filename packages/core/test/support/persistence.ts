import type { AtomicData } from "../../src/model";
import { type PersistedState, createSplitStorage, emptySync } from "../../src/persist-layout";
import { type KeyValueStorage, createMemoryStorage } from "../../src/storage";
import { type AtomicStore, type CrossTabChannel, createAtomicStore } from "../../src/store";

/**
 * Helpers for `hydration.test.ts` and `persistence.test.ts`: instrumented
 * key/value stores, a v1 main key, the §2.6.6 data set, and fake
 * BroadcastChannels.
 */

export const NAME = "atomic-habits";
export const T0 = 1_760_000_000_000;

/** Lets queued microtasks and zero-delay timers run. */
export const settle = async (rounds = 5) => {
	for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

export async function hydrated(store: AtomicStore): Promise<void> {
	for (let i = 0; i < 200 && !store.getState().hydrated; i++) await settle(1);
	if (!store.getState().hydrated) throw new Error("store never hydrated");
}

export interface RecordingKv extends KeyValueStorage {
	/** Keys written (setItem) since the last `reset()`, in order. */
	writes: string[];
	/** Keys removed since the last `reset()`. */
	removals: string[];
	reset(): void;
	/** When set, `setItem` throws for keys it returns true for. */
	failWrites: ((key: string) => boolean) | null;
	/** When set, `getItem` throws for keys it returns true for. */
	failReads: ((key: string) => boolean) | null;
	/** The stored value, read past any injected failure. */
	raw(key: string): string | null;
}

/** A memory kv that records writes and can fail on demand. Sync, with `keys()`. */
export function recordingKv(initial: Record<string, string> = {}): RecordingKv {
	const base = createMemoryStorage(initial);
	const kv: RecordingKv = {
		writes: [],
		removals: [],
		failWrites: null,
		failReads: null,
		reset() {
			kv.writes = [];
			kv.removals = [];
		},
		getItem(key) {
			if (kv.failReads?.(key)) throw new Error(`disk busy: ${key}`);
			return base.getItem(key);
		},
		setItem(key, value) {
			if (kv.failWrites?.(key)) {
				const error = new Error("The quota has been exceeded.");
				error.name = "QuotaExceededError";
				throw error;
			}
			kv.writes.push(key);
			return base.setItem(key, value);
		},
		removeItem(key) {
			kv.removals.push(key);
			return base.removeItem(key);
		},
		keys: (prefix) => base.keys?.(prefix) ?? Promise.resolve([]),
		raw: (key) => base.getItem(key) as string | null,
	};
	return kv;
}

export interface QuotaKv extends KeyValueStorage {
	/** Characters stored (keys and values), as browsers count localStorage. */
	used(): number;
	/** The largest `used()` seen so far. */
	peak(): number;
	/** Every successful `setItem`, in order, with the value written. */
	log: { key: string; value: string }[];
}

/**
 * localStorage-like: synchronous, and `setItem` throws `QuotaExceededError`
 * when the total would exceed `quota` characters (replacing a value frees
 * the old one first, as in browsers).
 */
export function quotaKv(quota: number, initial: Record<string, string> = {}): QuotaKv {
	const map = new Map(Object.entries(initial));
	const used = () => {
		let n = 0;
		for (const [key, value] of map) n += key.length + value.length;
		return n;
	};
	let peak = used();
	const kv: QuotaKv = {
		log: [],
		used,
		peak: () => peak,
		getItem: (key) => map.get(key) ?? null,
		setItem(key, value) {
			const before = map.get(key);
			const next =
				used() -
				(before === undefined ? 0 : key.length + before.length) +
				key.length +
				value.length;
			if (next > quota) {
				const error = new Error("The quota has been exceeded.");
				error.name = "QuotaExceededError";
				throw error;
			}
			map.set(key, value);
			kv.log.push({ key, value });
			peak = Math.max(peak, next);
		},
		removeItem(key) {
			map.delete(key);
		},
		keys: async (prefix) => [...map.keys()].filter((key) => key.startsWith(prefix)),
	};
	return kv;
}

/** Every key and value of a kv (awaits `keys()`). */
export async function dump(kv: KeyValueStorage): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const key of (await kv.keys?.("")) ?? []) {
		const value = await kv.getItem(key);
		if (value != null) out[key] = value;
	}
	return out;
}

/** Native-like: async reads and writes, no `keys()` (expo-sqlite kv as adapted in Phase 1A). */
export function asyncKv(base: KeyValueStorage): KeyValueStorage {
	return {
		getItem: async (key) => base.getItem(key),
		setItem: async (key, value) => base.setItem(key, value),
		removeItem: async (key) => base.removeItem(key),
	};
}

export function parse(raw: string | null | Promise<string | null>): Record<string, unknown> {
	if (typeof raw !== "string") throw new Error("expected a stored string");
	return JSON.parse(raw) as Record<string, unknown>;
}

/** The v1 persisted shape: one key with everything. */
export function v1MainKey(
	data: Partial<Record<string, Record<string, unknown>>>,
	sync: Record<string, unknown> | null = { cursor: 0, pending: {}, lastSyncedAt: null },
	settings: Record<string, unknown> = { displayName: "Ana" },
): string {
	return JSON.stringify({
		state: {
			data: { habits: {}, logs: {}, tasks: {}, identities: {}, scorecard: {}, ...data },
			settings,
			...(sync ? { sync } : {}),
		},
		version: 1,
	});
}

export const entity = (id: string, updatedAt = T0) => ({
	id,
	createdAt: T0,
	updatedAt,
	deletedAt: null as number | null,
});

/** A v1 habit document (no v2 fields). */
export function v1Habit(
	id: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		...entity(id),
		name: `Habit ${id}`,
		emoji: "📖",
		color: "ember",
		kind: "build",
		identityId: null,
		target: 1,
		unit: null,
		schedule: { type: "daily" },
		timeOfDay: "anytime",
		cueTime: null,
		cueLocation: null,
		stackAfter: null,
		bundle: null,
		twoMinute: null,
		reward: null,
		environment: null,
		why: null,
		reminder: false,
		startDate: "2025-01-01",
		archivedAt: null,
		order: 0,
		...overrides,
	};
}

export function v1Log(habitId: string, date: string, overrides: Record<string, unknown> = {}) {
	return {
		...entity(`${habitId}:${date}`),
		habitId,
		date,
		count: 1,
		skipped: false,
		note: null,
		...overrides,
	};
}

/** Writes `state` through the split layout, as the store would. */
export async function writeLayout(
	kv: KeyValueStorage,
	state: Partial<PersistedState> & { data: AtomicData },
): Promise<void> {
	const storage = createSplitStorage(kv, NAME, { debounceMs: 0 });
	await storage.getItem(NAME);
	storage.setItem(NAME, {
		state: {
			settings: state.settings ?? ({} as PersistedState["settings"]),
			sync: state.sync ?? emptySync(),
			foreign: state.foreign ?? {},
			dataRev: state.dataRev,
			data: state.data,
		},
		version: 1,
	});
	await storage.flush();
}

const pad = (n: number) => String(n).padStart(2, "0");
/** The i-th day from 2023-01-01 (local calendar). */
export const nthDay = (i: number) => {
	const d = new Date(2023, 0, 1 + i);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The §2.6.6 data set: 15k logs, 10k task logs, 10k tracker entries, 1k journal entries. */
export function bigDataSet(): AtomicData {
	const data: Record<
		| "habits"
		| "logs"
		| "tasks"
		| "identities"
		| "scorecard"
		| "taskLogs"
		| "journal"
		| "trackerEntries"
		| "translations",
		Record<string, unknown>
	> = {
		habits: {},
		logs: {},
		tasks: {},
		identities: {},
		scorecard: {},
		taskLogs: {},
		journal: {},
		trackerEntries: {},
		translations: {},
	};
	for (let h = 0; h < 15; h++) {
		data.habits[`h${h}`] = {
			...v1Habit(`h${h}`, { order: h }),
			emojiAuto: false,
			goalHistory: [],
			levelUp: null,
			tracker: null,
			lang: "en",
		};
	}
	for (let i = 0; i < 15_000; i++) {
		const log = v1Log(`h${i % 15}`, nthDay(Math.floor(i / 15)), { updatedAt: T0 + i });
		data.logs[log.id] = log;
	}
	for (let i = 0; i < 10_000; i++) {
		const date = nthDay(Math.floor(i / 10));
		const id = `t${i % 10}:${date}`;
		data.taskLogs[id] = {
			...entity(id, T0 + i),
			taskId: `t${i % 10}`,
			date,
			status: "done",
			resolvedOn: date,
		};
	}
	for (let i = 0; i < 10_000; i++) {
		const id = `e${i}`;
		data.trackerEntries[id] = {
			...entity(id, T0 + i),
			habitId: `h${i % 15}`,
			date: nthDay(Math.floor(i / 10)),
			type: "expense",
			at: T0 + i,
			data: { amount: 1250, currency: "BRL", category: "food", note: null },
		};
	}
	for (let i = 0; i < 1_000; i++) {
		const id = `j${i}`;
		data.journal[id] = {
			...entity(id, T0 + i),
			kind: "evidence",
			date: nthDay(i),
			identityId: null,
			habitId: null,
			answers: { proof: "Read twenty pages before bed." },
			rating: null,
			difficulty: null,
			range: null,
			contract: null,
			pinned: false,
		};
	}
	return data as unknown as AtomicData;
}

type Listener = (event: { data: unknown }) => void;

/**
 * BroadcastChannel fakes: a message posted on one is delivered (async) to
 * every other. `pause()` holds deliveries until `release()`, to stage races.
 */
export function channelHub() {
	const members = new Set<{ listeners: Set<Listener> }>();
	let delivered = 0;
	let held: (() => void)[] | null = null;
	const open = (): CrossTabChannel & { posted: unknown[] } => {
		const self = { listeners: new Set<Listener>() };
		members.add(self);
		return {
			posted: [],
			postMessage(message) {
				this.posted.push(message);
				for (const member of members) {
					if (member === self) continue;
					for (const listener of member.listeners) {
						const deliver = () => {
							delivered++;
							listener({ data: structuredClone(message) });
						};
						if (held) held.push(deliver);
						else setTimeout(deliver, 0);
					}
				}
			},
			addEventListener: (_type, listener) => {
				self.listeners.add(listener);
			},
			removeEventListener: (_type, listener) => {
				self.listeners.delete(listener);
			},
			close: () => {
				members.delete(self);
			},
		};
	};
	return {
		open,
		delivered: () => delivered,
		pause: () => {
			held ??= [];
		},
		release: () => {
			const queue = held ?? [];
			held = null;
			for (const deliver of queue) setTimeout(deliver, 0);
		},
	};
}

/** A store over `kv` with writes on every change (tests flush explicitly anyway). */
export function storeOn(kv: KeyValueStorage, extra: Parameters<typeof createAtomicStore>[0] = {}) {
	return createAtomicStore({ storage: kv, debounceMs: 0, now: () => T0 + 1_000_000, ...extra });
}
