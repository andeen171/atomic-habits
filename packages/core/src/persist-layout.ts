import type { StorageValue } from "zustand/middleware";
import {
	type AtomicData,
	COLLECTIONS,
	type Collection,
	DEFAULT_SETTINGS,
	SCHEMA_REV,
	type Settings,
	collectionSchemas,
	emptyData,
	settingsSchema,
} from "./model";
import { type FlushablePersistStorage, type KeyValueStorage, isMigratingStorage } from "./storage";
import { canonicalJson as canonical, compareVersions } from "./sync";
import { upgradeRecord } from "./upgrade";

/**
 * Local persistence: the split key layout and hydration (spec §2.6).
 *
 * | Key                                  | Content                                                     |
 * |--------------------------------------|-------------------------------------------------------------|
 * | `<name>`                             | v1-compatible: `{ state: { data: { habits, tasks, identities, scorecard }, settings, sync: { cursor, pending (keys of those four), lastSyncedAt } }, version: 1 }` |
 * | `<name>:meta`                        | `{ dataRev, sync: { …rest of SyncMeta, pending (other keys), cursorCopy }, foreign, slices, settings }` |
 * | `<name>:c:<logs|taskLogs|trackerEntries>:<YYYY>` | records whose `date` falls in that year         |
 * | `<name>:c:<journal|translations>`    | the whole collection                                        |
 * | `<name>:c:<other>`                   | written by a newer build: never read, never rewritten; only `purge()` deletes it |
 *
 * A downgraded v1 build reads only the main key: it shows no logs or v2 data
 * while downgraded. On re-upgrade, `getItem` merges the main key's records
 * with the slices by `updatedAt`, and a cursor that moved (`cursorCopy`)
 * triggers a re-pull. Nothing is lost.
 *
 * Writes go only to the parts that changed: a pointer diff of the records
 * against what is on disk finds the dirty year slices, and the main and meta
 * keys are rewritten only when their serialized content differs. One log
 * change therefore writes at most the main key, the meta key and one slice.
 *
 * A main key in an older layout (a v1 build's, with every log in it) is
 * migrated one year at a time: a year's slice is written, then the main key
 * is rewritten without that year's records. A year whose write fails (no room
 * for it next to the old main key: a localStorage quota) moves in halves,
 * recursively. Every state on disk in between is complete (`getItem` merges
 * main-key records with the slices), and the migration needs room for the
 * data plus the largest piece that fits, not twice the data.
 *
 * Hydration reports keys it could not read or parse (`onIncomplete`): the
 * store then marks its state `partial`, which holds derived writes and pushes
 * for the session. A corrupt key is backed up, a re-pull is requested
 * (`schemaRev = 1`), and the key is removed by `dropCorrupt()` once nothing
 * else replaced it.
 *
 * `meta.slices` lists the slice keys so backends without `keys()` (native)
 * still find every slice; it is an addition to the spec's meta content.
 *
 * `meta.settings` is a copy of the settings (another addition). A downgraded
 * v1 build rewrites the main key with only the settings it knows (its schema
 * strips the others), so on re-upgrade the keys missing from the main key's
 * settings come from this copy: device-local switches such as "Sync journal:
 * off" (D19) and "Back up photos: off" survive v2 → v1 → v2 (§2.9) instead of
 * falling back to their defaults.
 *
 * Pending keys are split by where their records live (Amends §2.6.2, which
 * said "v1-collection keys"): the main key holds those of the four main
 * collections, the meta key every other one, `logs/…` included. A downgraded
 * v1 build sees no logs in the main key, so it would drop their pending keys
 * as orphans; kept in the meta key, they survive until the re-upgrade.
 */

// ── Sync meta and persisted state (spec §2.6.3) ──

export interface SyncMeta {
	/** Last server sequence pulled. */
	cursor: number;
	/** Entities changed locally since the last successful push. */
	pending: Record<string, true>;
	lastSyncedAt: number | null;
	/** SCHEMA_REV the cursor was built under; < SCHEMA_REV ⇒ re-pull from 0 (§2.7). */
	schemaRev: number;
	/** Pending keys are recorded only while signed in. */
	tracking: boolean;
	/** pendingKey → remote updatedAt of a newer document this build cannot parse. */
	superseded: Record<string, number>;
	/** Last 50 server rejections, shown on the Account page. */
	rejected: { key: string; code: string; at: number }[];
	/** Applied by stamp() when |offset| > 2 min; else 0. */
	clockOffsetMs: number;
	blobsUploaded: Record<string, true>;
	blobsCheckedAt: number | null;
	blobsUnuploadable: Record<string, "too-large" | "unsupported">;
}

export function emptySync(): SyncMeta {
	return {
		cursor: 0,
		pending: {},
		lastSyncedAt: null,
		schemaRev: SCHEMA_REV,
		tracking: false,
		superseded: {},
		rejected: [],
		clockOffsetMs: 0,
		blobsUploaded: {},
		blobsCheckedAt: null,
		blobsUnuploadable: {},
	};
}

/** Collections this build doesn't know, keyed by name, records kept verbatim. */
export type ForeignData = Record<string, Record<string, unknown>>;

export interface PersistedState {
	data: AtomicData;
	settings: Settings;
	sync: SyncMeta;
	/** Unknown collections found inside the main key's `data`; kept verbatim. */
	foreign?: ForeignData;
	/** SCHEMA_REV the persisted records were last normalized under. */
	dataRev?: number;
}

// ── Layout ──

/** Stored whole inside the main key (v1 builds read them). */
export const MAIN_COLLECTIONS = ["habits", "tasks", "identities", "scorecard"] as const;
/** Sliced by the year of their `date`. Every other collection gets one `c:<name>` key. */
export const YEAR_SLICED_COLLECTIONS = ["logs", "taskLogs", "trackerEntries"] as const;

export type SliceLayout = "main" | "year" | "whole";

const MAIN_SET: ReadonlySet<string> = new Set(MAIN_COLLECTIONS);
const YEAR_SET: ReadonlySet<string> = new Set(YEAR_SLICED_COLLECTIONS);
const KNOWN_SET: ReadonlySet<string> = new Set(COLLECTIONS);
/** Year slice of records without a usable `date` (invalid records kept raw). */
const UNDATED = "0000";
const WHOLE = "all";

export function isKnownCollection(name: string): name is Collection {
	return KNOWN_SET.has(name);
}

export function layoutOf(collection: string): SliceLayout {
	if (MAIN_SET.has(collection)) return "main";
	if (YEAR_SET.has(collection)) return "year";
	return "whole";
}

export function metaKey(name: string): string {
	return `${name}:meta`;
}

/** `<name>:c:<collection>` or `<name>:c:<collection>:<YYYY>`. */
export function sliceKey(name: string, collection: string, year?: string): string {
	return year === undefined ? `${name}:c:${collection}` : `${name}:c:${collection}:${year}`;
}

/** The known collection and bucket of a slice key; null for keys this build doesn't read. */
export function parseSliceKey(
	name: string,
	key: string,
): { collection: Collection; bucket: string } | null {
	const prefix = `${name}:c:`;
	if (!key.startsWith(prefix)) return null;
	const parts = key.slice(prefix.length).split(":");
	const collection = parts[0] ?? "";
	if (!isKnownCollection(collection)) return null;
	const layout = layoutOf(collection);
	if (layout === "year" && parts.length === 2 && /^\d{4}$/.test(parts[1] ?? "")) {
		return { collection, bucket: parts[1] as string };
	}
	if (layout === "whole" && parts.length === 1) return { collection, bucket: WHOLE };
	return null;
}

function bucketOf(layout: SliceLayout, record: unknown): string {
	if (layout !== "year") return WHOLE;
	const date = isRecord(record) ? record.date : undefined;
	return typeof date === "string" && /^\d{4}/.test(date) ? date.slice(0, 4) : UNDATED;
}

function bucketKey(name: string, collection: Collection, bucket: string): string {
	return bucket === WHOLE ? sliceKey(name, collection) : sliceKey(name, collection, bucket);
}

// ── Small helpers ──

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Last-write-wins merge of `source` into `target` (mutated), in the sync
 * order (`compareVersions`: equal `updatedAt` broken by content). Equal
 * versions keep `target`'s object.
 */
function lwwInto(target: Json, source: Json): Json {
	for (const id in source) {
		const incoming = source[id];
		if (!isRecord(incoming)) continue;
		const current = target[id];
		if (current === undefined || compareVersions(incoming, current) > 0) target[id] = incoming;
	}
	return target;
}

const clock = (): number =>
	typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();

type Maybe<T> = T | Promise<T>;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
	typeof (value as { then?: unknown } | null)?.then === "function";

/** Applies `fn` synchronously to a plain value, or after a promise resolves. */
function chain<T, U>(value: Maybe<T>, fn: (value: T) => Maybe<U>): Maybe<U> {
	return isThenable(value) ? (value as Promise<T>).then(fn) : fn(value as T);
}

// ── Normalization and hydration (spec §2.6.4) ──

/** `upgradeRecord`, then the schema; `{...upgraded, ...parsed}` on success, the raw record otherwise. */
export function normalizeRecord(collection: Collection, raw: Json): Json {
	const upgraded = upgradeRecord(collection, raw);
	const parsed = collectionSchemas[collection].safeParse(upgraded);
	return parsed.success ? { ...upgraded, ...(parsed.data as Json) } : raw;
}

/** A collection map with only object records; the same object when nothing is dropped. */
function recordMap(value: unknown): Json | null {
	if (!isRecord(value)) return null;
	for (const id in value) {
		if (isRecord(value[id])) continue;
		const out: Json = {};
		for (const key in value) if (isRecord(value[key])) out[key] = value[key];
		return out;
	}
	return value;
}

export interface HydrationResult {
	data: AtomicData;
	settings: Settings;
	sync: SyncMeta;
	foreign: ForeignData;
	/** Set when records were normalized because `dataRev` differed from SCHEMA_REV. */
	normalized: { records: number; ms: number } | null;
}

/** Above this, the normalization log line is a warning (spec §2.6.6). */
export const SLOW_NORMALIZATION_MS = 500;

/** Rule 4: `{ ...emptySync(), ...p.sync }` plus the migrations; damaged fields get their defaults. */
function syncFrom(value: unknown): SyncMeta {
	if (!isRecord(value)) return emptySync();
	const out = { ...emptySync(), ...value } as SyncMeta;
	if (!(typeof value.cursor === "number" && value.cursor >= 0)) out.cursor = 0;
	if (!isRecord(value.pending)) out.pending = {};
	if (typeof value.lastSyncedAt !== "number") out.lastSyncedAt = null;
	// Persisted by v1 (no schemaRev): the next sync re-pulls from 0 (§2.7).
	if (typeof value.schemaRev !== "number") out.schemaRev = 1;
	// Pending keys were recorded unconditionally before; keep tracking for devices that synced.
	if (typeof value.tracking !== "boolean") {
		out.tracking = out.cursor > 0 || out.lastSyncedAt != null;
		// A device that never synced: sign-in marks everything pending anyway
		// (D57), so the keys a v1 build recorded for every write are dropped.
		// Kept, they would double the log keys in the meta key while the main
		// key is migrated (localStorage quotas).
		if (!out.tracking) out.pending = {};
	}
	if (!isRecord(value.superseded)) out.superseded = {};
	if (!Array.isArray(value.rejected)) out.rejected = [];
	if (typeof value.clockOffsetMs !== "number") out.clockOffsetMs = 0;
	if (!isRecord(value.blobsUploaded)) out.blobsUploaded = {};
	if (typeof value.blobsCheckedAt !== "number") out.blobsCheckedAt = null;
	if (!isRecord(value.blobsUnuploadable)) out.blobsUnuploadable = {};
	return out;
}

/**
 * The store's `merge(persisted)` rules 1–5 (spec §2.6.4). Pure; the store
 * then runs `deriveAutoEmojis` (rule 6).
 *
 * 1. Known collections: records from `data` (main key + slices, already
 *    joined by `getItem`) and `foreign[c]`, merged by last-write-wins.
 * 2. When `dataRev !== SCHEMA_REV`, every record of every known collection
 *    except `logs` goes through `upgradeRecord` and its schema; invalid
 *    records stay raw. Otherwise records are copied raw.
 * 3. Unknown collections are kept in `foreign`.
 * 4. Sync meta: `{ ...emptySync(), ...p.sync }`; a persisted sync without
 *    `schemaRev` gets 1 (one-time re-pull); `tracking ??= cursor > 0 ||
 *    lastSyncedAt != null`, and when that infers false the pending keys are
 *    dropped (an addition: sign-in marks everything pending, D57).
 * 5. Settings as in v1.
 */
export function hydratePersisted(persisted: unknown): HydrationResult {
	const p = isRecord(persisted) ? persisted : {};
	const pData = isRecord(p.data) ? p.data : {};
	const pForeign = isRecord(p.foreign) ? p.foreign : {};
	// A fresh install has nothing to normalize.
	const normalize = isRecord(persisted) && p.dataRev !== SCHEMA_REV;
	const started = clock();
	let normalized = 0;

	const data = emptyData() as Record<Collection, Json>;
	for (const collection of COLLECTIONS) {
		let records = recordMap(pData[collection]);
		const extra = recordMap(pForeign[collection]);
		if (extra) records = lwwInto(records ? { ...records } : {}, extra);
		if (!records) continue;
		if (normalize && collection !== "logs") {
			const out: Json = {};
			for (const id in records) {
				out[id] = normalizeRecord(collection, records[id] as Json);
				normalized++;
			}
			records = out;
		}
		data[collection] = records;
	}

	const foreign: ForeignData = {};
	for (const [name, records] of Object.entries(pForeign)) {
		if (!isKnownCollection(name) && isRecord(records)) foreign[name] = records;
	}

	const settings = settingsSchema.safeParse({
		...DEFAULT_SETTINGS,
		...(isRecord(p.settings) ? p.settings : {}),
	});

	return {
		data: data as unknown as AtomicData,
		settings: settings.success ? settings.data : { ...DEFAULT_SETTINGS },
		sync: syncFrom(p.sync),
		foreign,
		normalized: normalize ? { records: normalized, ms: clock() - started } : null,
	};
}

/** The §2.6.6 performance log line for the normalization path. */
export function logNormalization(result: HydrationResult): void {
	if (!result.normalized) return;
	const { records, ms } = result.normalized;
	const line = `[atomic] Normalized ${records} records to schema rev ${SCHEMA_REV} in ${ms.toFixed(1)} ms`;
	if (ms > SLOW_NORMALIZATION_MS) console.warn(`${line} (slow)`);
	else console.info(line);
}

// ── Reading the layout ──

type RawRead = { raw: string | null } | { error: unknown };

function readRaw(kv: KeyValueStorage, key: string): Maybe<RawRead> {
	try {
		const value = kv.getItem(key);
		if (isThenable(value)) {
			return (value as Promise<string | null>).then(
				(raw) => ({ raw: raw ?? null }),
				(error: unknown) => ({ error }),
			);
		}
		return { raw: (value as string | null) ?? null };
	} catch (error) {
		return { error };
	}
}

function readAll(kv: KeyValueStorage, keys: readonly string[]): Maybe<RawRead[]> {
	const results = keys.map((key) => readRaw(kv, key));
	return results.some(isThenable) ? Promise.all(results) : (results as RawRead[]);
}

/**
 * Parses a stored value. A payload that is not a JSON object is corrupt: it
 * is backed up under `<key>:corrupt:<time>` and its key added to `corrupt`.
 */
function parseStored(
	kv: KeyValueStorage,
	key: string,
	raw: string | null,
	corrupt?: string[],
): Json | null {
	if (!raw) return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		value = undefined;
	}
	if (isRecord(value)) return value;
	corrupt?.push(key);
	try {
		void Promise.resolve(kv.setItem(`${key}:corrupt:${Date.now()}`, raw)).catch(() => {});
	} catch {
		// best effort
	}
	return null;
}

interface SliceRead {
	key: string;
	collection: Collection;
	bucket: string;
	records: Json;
}

interface LayoutRead {
	main: Json | null;
	meta: Json | null;
	slices: SliceRead[];
	/** `c:*` keys this build doesn't read (newer collections, backups). Deleted only by `purge()`. */
	otherSlices: string[];
	/** The first read failure, if any. */
	error: unknown;
	/** Keys whose payload could not be parsed (backed up, read as missing). */
	corrupt: string[];
}

const emptyRead = (): LayoutRead => ({
	main: null,
	meta: null,
	slices: [],
	otherSlices: [],
	error: undefined,
	corrupt: [],
});

const hasContent = (read: LayoutRead) =>
	read.main !== null || read.meta !== null || read.slices.length > 0;

function listedSlices(name: string, meta: Json | null): string[] {
	const list = meta?.slices;
	if (!Array.isArray(list)) return [];
	return list.filter((s): s is string => typeof s === "string").map((s) => `${name}:${s}`);
}

/** Oldest year probed for slices when the slice listing is lost on a backend without `keys()`. */
const PROBE_FIRST_YEAR = 1990;

/**
 * Every slice key this build could have written: the whole-collection slices
 * and the year slices from PROBE_FIRST_YEAR to next year (plus undated).
 */
function candidateSliceKeys(name: string): string[] {
	const keys: string[] = [];
	const last = new Date().getFullYear() + 1;
	for (const collection of COLLECTIONS) {
		const layout = layoutOf(collection);
		if (layout === "whole") keys.push(sliceKey(name, collection));
		if (layout !== "year") continue;
		keys.push(sliceKey(name, collection, UNDATED));
		for (let year = PROBE_FIRST_YEAR; year <= last; year++) {
			keys.push(sliceKey(name, collection, String(year)));
		}
	}
	return keys;
}

/** A main key in this build's layout (only the four main collections in `data`). */
function isLayoutMain(main: Json | null): boolean {
	const state = isRecord(main?.state) ? main.state : null;
	return state !== null && isRecord(state.data) && !writtenByOlderBuild(state.data);
}

/**
 * Reads the main key, the meta key and every known slice. Synchronous when
 * the backend is (memory, localStorage), so the first render already has the
 * user's data; then it relies on `meta.slices`. Async backends also discover
 * slices through `keys()`.
 *
 * When the meta key is missing or corrupt next to a main key in this layout,
 * the slice listing is lost: slices are then discovered through `keys()` on
 * every backend (hydration goes async), or by probing every slice key this
 * build could have written when the backend has no `keys()`. Otherwise the
 * next write to a slice nobody read would replace a year of history.
 */
function readLayout(kv: KeyValueStorage, name: string): Maybe<LayoutRead> {
	const first = readAll(kv, [name, metaKey(name)]);
	const async = isThenable(first);
	return chain(first, ([mainRead, metaRead]) => {
		const out = emptyRead();
		const absorb = (read: RawRead | undefined, key: string): Json | null => {
			if (!read) return null;
			if ("error" in read) {
				out.error ??= read.error;
				return null;
			}
			return parseStored(kv, key, read.raw, out.corrupt);
		};
		out.main = absorb(mainRead, name);
		out.meta = absorb(metaRead, metaKey(name));

		const listingLost =
			out.meta === null &&
			metaRead !== undefined &&
			!("error" in metaRead) &&
			isLayoutMain(out.main);
		if (listingLost) {
			console.warn("[atomic] The slice listing was missing or corrupt; looking for slices");
		}
		const fallback = () => (listingLost ? candidateSliceKeys(name) : []);
		const discovered: Maybe<string[]> =
			kv.keys && (async || listingLost) ? kv.keys(`${name}:c:`).catch(fallback) : fallback();
		return chain(discovered, (found) => {
			const keys = [...new Set([...listedSlices(name, out.meta), ...found])];
			const known: { key: string; collection: Collection; bucket: string }[] = [];
			for (const key of keys) {
				const parsed = parseSliceKey(name, key);
				if (parsed) known.push({ key, ...parsed });
				else out.otherSlices.push(key);
			}
			return chain(
				readAll(
					kv,
					known.map((k) => k.key),
				),
				(results) => {
					results.forEach((read, i) => {
						const slice = known[i];
						if (!slice) return;
						if ("error" in read) {
							out.error ??= read.error;
							return;
						}
						const records = parseStored(kv, slice.key, read.raw, out.corrupt);
						if (records) out.slices.push({ ...slice, records });
					});
					return out;
				},
			);
		});
	});
}

/** Loose persisted state as joined from the keys; `hydratePersisted` cleans it up. */
interface JoinedState {
	data: Json;
	foreign: Json;
	settings?: unknown;
	sync?: Json;
	dataRev?: unknown;
}

/** A map we may mutate: copies `value` the first time it is merged into. */
function ownedMerge(owner: Json, key: string, source: Json, owned: Set<Json>): void {
	const current = owner[key];
	if (!isRecord(current)) {
		owner[key] = source;
		return;
	}
	let target = current;
	if (!owned.has(target)) {
		target = { ...current };
		owned.add(target);
		owner[key] = target;
	}
	lwwInto(target, source);
}

/** Every record of a map through `normalizeRecord` (a new map). */
function normalizeMap(collection: Collection, records: Json): Json {
	const out: Json = {};
	for (const id in records) {
		const record = records[id];
		if (isRecord(record)) out[id] = normalizeRecord(collection, record);
	}
	return out;
}

/**
 * The main key was written by an older build: this build writes exactly the
 * four main collections there, and a v1 build always writes `data.logs` too.
 */
function writtenByOlderBuild(mainData: Json): boolean {
	for (const key in mainData) if (!MAIN_SET.has(key)) return true;
	return false;
}

/**
 * Joins the keys into one persisted state. Slices go first, so a main-key
 * copy of the same version (an older build's) keeps the slice's object;
 * copies that differ merge in the sync order (`compareVersions`).
 *
 * Records in a main key an older build wrote (a downgrade v2 → v1 → v2) are
 * normalized here (spec §2.3: `upgradeRecord` runs on every read path), even
 * though the meta key's `dataRev` says the data is current: a ✨ habit the v1
 * build created must become auto (D12) like it does on devices that pull it.
 */
function joinLayout(read: LayoutRead): JoinedState {
	const owned = new Set<Json>();
	const main = isRecord(read.main?.state) ? (read.main.state as Json) : {};
	const mainData = isRecord(main.data) ? main.data : {};
	const older = writtenByOlderBuild(mainData);
	const meta = read.meta ?? {};
	const data: Json = {};
	for (const slice of read.slices) ownedMerge(data, slice.collection, slice.records, owned);

	const foreign: Json = {};
	if (isRecord(meta.foreign)) {
		for (const [name, records] of Object.entries(meta.foreign)) {
			if (isRecord(records)) foreign[name] = records;
		}
	}
	for (const [name, records] of Object.entries(mainData)) {
		if (!isRecord(records)) continue;
		if (!isKnownCollection(name)) ownedMerge(foreign, name, records, owned);
		else if (older && name !== "logs") ownedMerge(data, name, normalizeMap(name, records), owned);
		else ownedMerge(data, name, records, owned);
	}

	const mainSync = isRecord(main.sync) ? main.sync : null;
	const metaSync = isRecord(meta.sync) ? meta.sync : null;
	let sync: Json | undefined;
	if (mainSync || metaSync) {
		const { cursorCopy, pending: metaPending, ...metaRest } = metaSync ?? {};
		const { pending: mainPending, ...mainRest } = mainSync ?? {};
		sync = {
			...metaRest,
			...mainRest,
			pending: {
				...(isRecord(mainPending) ? mainPending : {}),
				...(isRecord(metaPending) ? metaPending : {}),
			},
		};
		// Another build (a downgraded v1) synced in between: re-pull (§2.6.2).
		if (metaSync && cursorCopy !== mainSync?.cursor) sync.schemaRev = 1;
	}
	return {
		data,
		foreign,
		settings: joinSettings(main.settings, meta.settings),
		sync,
		dataRev: meta.dataRev,
	};
}

/**
 * The main key's settings, with the keys it lacks taken from the meta key's
 * copy (a v1 build strips the settings it doesn't know when it rewrites the
 * main key). Keys present in the main key win: they are the newest.
 */
function joinSettings(main: unknown, meta: unknown): unknown {
	if (!isRecord(meta)) return main;
	if (!isRecord(main)) return meta;
	return { ...meta, ...main };
}

/** Normalizes every record of a joined state (legacy data written by an older build). */
function normalizeJoined(state: JoinedState): JoinedState {
	const data: Json = {};
	for (const [name, records] of Object.entries(state.data)) {
		if (!isRecord(records)) continue;
		data[name] =
			!isKnownCollection(name) || name === "logs" ? records : normalizeMap(name, records);
	}
	return { ...state, data };
}

/** Merges `extra` (an older backend's data) into `base`: records by LWW, pending keys unioned. */
function mergeJoined(base: JoinedState, extra: JoinedState): JoinedState {
	const owned = new Set<Json>();
	const data = { ...base.data };
	for (const [name, records] of Object.entries(extra.data)) {
		if (isRecord(records)) ownedMerge(data, name, records, owned);
	}
	const foreign = { ...base.foreign };
	for (const [name, records] of Object.entries(extra.foreign)) {
		if (isRecord(records)) ownedMerge(foreign, name, records, owned);
	}
	let sync = base.sync ?? extra.sync;
	if (base.sync && extra.sync) {
		sync = {
			...base.sync,
			pending: {
				...(isRecord(base.sync.pending) ? base.sync.pending : {}),
				...(isRecord(extra.sync.pending) ? extra.sync.pending : {}),
			},
		};
	}
	return { ...base, data, foreign, settings: base.settings ?? extra.settings, sync };
}

// ── The split storage ──

/** Records and keys another tab (or an older build's backend) wrote. */
export interface ExternalChanges {
	/** Every record read; the store keeps the strictly newer ones. */
	data: Partial<Record<Collection, Record<string, unknown>>>;
	foreign: ForeignData;
	pending: Record<string, true>;
	/** Settings from the main key, when it was read. */
	settings?: unknown;
}

export interface SplitStorageOptions {
	/** Coalesce writes for this long. Default 200 ms; 0 writes on every change. */
	debounceMs?: number;
	/** The zustand persist version reported on reads (STORE_VERSION). Default 1. */
	version?: number;
	/** A read or write failed (the store sets `persistError`). */
	onError?: (error: unknown) => void;
	/** A write attempt succeeded; `keys` are the keys it wrote or removed (maybe none). */
	onSaved?: (keys: string[]) => void;
	/**
	 * A write found records on disk this tab never read (a slice missing from a
	 * lost listing). They were kept on disk; the store should merge them in.
	 */
	onDiscovered?: (changes: ExternalChanges) => void;
	/**
	 * Hydration could not read every key, so the state it returns may lack
	 * records. Called before `getItem` returns. `unreadable`: a read failed
	 * (the storage is then read-only for the session). `corrupt`: keys whose
	 * payload could not be parsed (backed up; the returned sync meta asks for a
	 * re-pull).
	 */
	onIncomplete?: (info: HydrationGaps) => void;
}

/** What hydration could not read (`SplitStorageOptions.onIncomplete`). */
export interface HydrationGaps {
	unreadable: boolean;
	corrupt: readonly string[];
}

export interface SplitPersistStorage extends FlushablePersistStorage<PersistedState> {
	/** The layout keys of this store. */
	readonly layout: { main: string; meta: string; slicePrefix: string };
	/**
	 * Re-reads keys another tab wrote (BroadcastChannel), records what is now
	 * on disk, and returns the records, pending keys and settings to merge.
	 * `current` is the in-memory state.
	 */
	readKeys(
		keys: readonly string[],
		current: () => { data: AtomicData },
	): Promise<ExternalChanges | null>;
	/**
	 * After `readKeys` and the merge: writes only what the disk lacks (records
	 * it has older or not at all, pending keys, slice listings). Unlike
	 * `setItem`, it never rewrites a key just for this tab's own cursor, sync
	 * meta or settings, so two tabs never echo each other's writes.
	 */
	repair(value: StorageValue<PersistedState>): Promise<void>;
	/**
	 * Web: data an older build wrote to localStorage after the move to
	 * IndexedDB (a stale v1 tab). Returns it normalized for merging; it is
	 * removed after the next successful write.
	 */
	readLegacy(): Promise<ExternalChanges | null>;
	/** Deletes every layout key: main, meta, every `c:*` slice (known or not) and the legacy key. */
	purge(): Promise<void>;
	/**
	 * Removes the corrupt keys hydration found (each was backed up under
	 * `<key>:corrupt:<time>`) that no write has replaced since, so later
	 * sessions read every key again. The store calls it once their records
	 * can't come back any other way: right away when not tracking, else after
	 * the requested re-pull completed. No-op while read-only.
	 */
	dropCorrupt(): Promise<void>;
	/**
	 * Turns the storage read-only for the session and drops any queued write
	 * (hydration failed: writing the in-memory state would replace the data on
	 * disk). `purge()` still works.
	 */
	lock(): void;
}

/** One slice as on disk: its record map (the parsed or written object) and its size. */
interface BucketSnap {
	records: Json;
	count: number;
}

interface CollectionSnap {
	/** The record map last diffed, so an untouched collection is skipped by identity. */
	map: unknown;
	/** bucket (year, or "all") → what that slice holds on disk. */
	buckets: Map<string, BucketSnap>;
}

/** The main key as on disk. */
interface MainSnap {
	/** The four main collections as on disk. */
	records: Map<string, BucketSnap>;
	/** Record maps last diffed against `records`, so untouched ones are skipped by identity. */
	maps: Map<string, unknown>;
	/** Canonical JSON. */
	settings: string;
	cursor: unknown;
	lastSyncedAt: unknown;
	pending: ReadonlySet<string>;
	/** Holds exactly this layout (not, say, logs that a downgraded v1 build added). */
	exact: boolean;
	/**
	 * Not `exact`: the buckets of the sliced collections it holds records of
	 * (a v1 main key: every year of logs). Migrated one bucket at a time.
	 */
	legacy: ReadonlyMap<Collection, ReadonlySet<string>>;
}

/** The meta key as on disk. */
interface MetaSnap {
	dataRev: unknown;
	/** Canonical JSON of the sync meta without cursor, pending, lastSyncedAt and cursorCopy. */
	rest: string;
	cursorCopy: unknown;
	pending: ReadonlySet<string>;
	/** Canonical JSON. */
	foreign: string;
	/** Listed slices, relative to the store name ("c:logs:2026"). */
	slices: ReadonlySet<string>;
	/** Canonical JSON of the settings copy. */
	settings: string;
}

interface WriteOp {
	key: string;
	/** null removes the key (unless `lazy` is set). */
	value: string | null;
	/** Serialized only when the op runs (the migration's intermediate main keys). */
	lazy?: () => string;
	/**
	 * A slice this tab doesn't know is on disk (listing lost, another tab's
	 * missed write): read and merged before it is written, never replaced unread.
	 */
	fresh?: { collection: Collection; snap: BucketSnap };
	/** The bucket a slice write fills, for the migration of an older main key. */
	slice?: {
		collection: Collection;
		bucket: string;
		snap: BucketSnap;
		/** What the slice holds on disk before the write, when known. */
		disk?: Json;
	};
	/**
	 * The write failed (a localStorage quota): the smaller writes that reach the
	 * same end state instead, or null when there are none. Migration steps only.
	 */
	split?: () => WriteOp[] | null;
	/** Called once the op (or the smaller writes that replaced it) succeeded. */
	done?: () => void;
}

type WriteMode = "normal" | "repair";

const countKeys = (records: Json): number => {
	let count = 0;
	for (const _ in records) count++;
	return count;
};

const keySet = (value: unknown): Set<string> => new Set(isRecord(value) ? Object.keys(value) : []);

function containsAll(set: ReadonlySet<string>, keys: Json): boolean {
	for (const key in keys) if (!set.has(key)) return false;
	return true;
}

/** Sync meta without the main key's fields and the cursor copy. */
function syncRest(sync: Json): Json {
	const {
		cursor: _cursor,
		pending: _pending,
		lastSyncedAt: _last,
		cursorCopy: _copy,
		...rest
	} = sync;
	return rest;
}

/** Maps a record map as read to the one to remember (cross-tab reads keep equal own records). */
type Align = (collection: string, records: Json) => Json;

function mainSnapOf(value: Json, align?: Align): MainSnap {
	const state = isRecord(value.state) ? value.state : null;
	const data = state && isRecord(state.data) ? state.data : null;
	const sync = state && isRecord(state.sync) ? state.sync : {};
	let exact = data !== null;
	const legacy = new Map<Collection, Set<string>>();
	if (data) {
		for (const key in data) {
			if (MAIN_SET.has(key)) continue;
			exact = false;
			const held = data[key];
			if (!isKnownCollection(key) || !isRecord(held)) continue;
			const buckets = new Set<string>();
			for (const id in held) buckets.add(bucketOf(layoutOf(key), held[id]));
			if (buckets.size) legacy.set(key, buckets);
		}
	}
	const records = new Map<string, BucketSnap>();
	for (const collection of MAIN_COLLECTIONS) {
		const raw = data && isRecord(data[collection]) ? (data[collection] as Json) : {};
		const map = align ? align(collection, raw) : raw;
		records.set(collection, { records: map, count: countKeys(map) });
	}
	return {
		records,
		maps: new Map(),
		settings: canonical(state?.settings),
		cursor: sync.cursor,
		lastSyncedAt: sync.lastSyncedAt,
		pending: keySet(sync.pending),
		exact,
		legacy,
	};
}

function metaSnapOf(value: Json): MetaSnap {
	const sync = isRecord(value.sync) ? value.sync : {};
	const slices = Array.isArray(value.slices)
		? value.slices.filter((s): s is string => typeof s === "string")
		: [];
	return {
		dataRev: value.dataRev,
		rest: canonical(syncRest(sync)),
		cursorCopy: sync.cursorCopy,
		pending: keySet(sync.pending),
		foreign: canonical(value.foreign ?? {}),
		slices: new Set(slices),
		settings: canonical(value.settings),
	};
}

const PRISTINE_SETTINGS = JSON.stringify(DEFAULT_SETTINGS);
const PRISTINE_SYNC = JSON.stringify(emptySync());

/** No records, no foreign data, default settings and sync meta. */
function isPristine(state: PersistedState): boolean {
	const data = (isRecord(state.data) ? state.data : {}) as Json;
	for (const collection in data) {
		const records = data[collection];
		if (isRecord(records)) for (const _ in records) return false;
	}
	if (isRecord(state.foreign)) for (const _ in state.foreign) return false;
	return (
		JSON.stringify(state.settings) === PRISTINE_SETTINGS &&
		JSON.stringify(state.sync) === PRISTINE_SYNC
	);
}

const sameParts = (a: readonly unknown[] | null, b: readonly unknown[]): boolean =>
	a !== null && a.length === b.length && a.every((value, i) => value === b[i]);

function call(fn: () => void | Promise<void>): Promise<void> {
	try {
		return Promise.resolve(fn());
	} catch (error) {
		return Promise.reject(error);
	}
}

/** A value computed from one object, recomputed only when the object changes. */
function memo<T>(compute: (value: unknown) => T): (value: unknown) => T {
	let last: { value: unknown; result: T } | null = null;
	return (value) => {
		if (!last || last.value !== value) last = { value, result: compute(value) };
		return last.result;
	};
}

/**
 * zustand `PersistStorage` over the split layout. `getItem` joins the keys
 * (synchronously for synchronous backends); `setItem` writes only what
 * changed. Disk operations run one at a time, in order.
 *
 * Dirtiness is decided against what this tab knows is on disk, never by
 * comparing serialized strings: records by object identity (records read
 * from disk keep their objects), pending keys as sets, settings and sync meta
 * canonically. Key order therefore never causes a write.
 *
 * - A failed read turns the storage read-only for the session (a write would
 *   replace real data with what could be read); the error is reported.
 * - A failed write is reported and retried with the next change.
 * - Web, on IndexedDB: when IndexedDB has no data and localStorage does, the
 *   localStorage data is hydrated and written to IndexedDB, then removed. If
 *   it reappears (a stale v1 tab), it is merged by record and removed again.
 */
export function createSplitStorage(
	kv: KeyValueStorage,
	name: string,
	options: SplitStorageOptions = {},
): SplitPersistStorage {
	const debounceMs = options.debounceMs ?? 200;
	const version = options.version ?? 1;
	const layout = { main: name, meta: metaKey(name), slicePrefix: `${name}:c:` };
	const relative = (key: string) => key.slice(name.length + 1);

	// What is on disk, as far as this tab knows.
	let diskMain: MainSnap | null = null;
	let diskMeta: MetaSnap | null = null;
	let diskSlices = new Set<string>();
	let otherSlices = new Set<string>();
	let collections = new Map<Collection, CollectionSnap>();
	let attempted: unknown[] | null = null;
	/** Corrupt keys hydration found (backed up) that no write has replaced since. */
	let corruptKeys = new Set<string>();

	const settingsJson = memo(canonical);
	const restJson = memo((sync) => canonical(syncRest(isRecord(sync) ? sync : {})));
	const foreignJson = memo((foreign) => canonical(foreign ?? {}));
	/** Pending keys of the main collections (main key) and every other one (meta key). */
	const splitPending = memo((value) => {
		const main: Json = {};
		const other: Json = {};
		let mainCount = 0;
		let otherCount = 0;
		const pending = isRecord(value) ? value : {};
		for (const key in pending) {
			const slash = key.indexOf("/");
			if (slash > 0 && MAIN_SET.has(key.slice(0, slash))) {
				main[key] = pending[key];
				mainCount++;
			} else {
				other[key] = pending[key];
				otherCount++;
			}
		}
		return { main, other, mainCount, otherCount };
	});

	let ready = false;
	let readOnly = false;
	let pendingValue: StorageValue<PersistedState> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	/** An older backend's keys to remove after the next successful write. */
	let legacyRemoval: { kv: KeyValueStorage; keys: string[] } | null = null;
	/** Attempt the next write even if nothing changed (once; a failure doesn't re-arm it). */
	let force = false;

	// One disk operation at a time, in call order; an idle queue starts the
	// task synchronously. Counted from enqueue to completion: a task chained
	// on the tail hasn't started yet right after the one before it finished,
	// and a later call must not overtake it (a `flush()` resolving first).
	let tail: Promise<unknown> = Promise.resolve();
	let queued = 0;
	const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
		const idle = queued === 0;
		queued++;
		const run = () =>
			task().finally(() => {
				queued--;
			});
		const result = idle ? run() : tail.then(run, run);
		tail = result.catch(() => undefined);
		return result;
	};

	const reportError = (error: unknown) => {
		try {
			options.onError?.(error);
		} catch {
			// a listener must not break persistence
		}
	};

	const seedSnapshot = (read: LayoutRead) => {
		diskMain = read.main ? mainSnapOf(read.main) : null;
		diskMeta = read.meta ? metaSnapOf(read.meta) : null;
		diskSlices = new Set(read.slices.map((s) => s.key));
		otherSlices = new Set(read.otherSlices);
		collections = new Map();
		for (const slice of read.slices) {
			let snap = collections.get(slice.collection);
			if (!snap) {
				snap = { map: null, buckets: new Map() };
				collections.set(slice.collection, snap);
			}
			// The parsed object itself: joining copies before merging into it.
			snap.buckets.set(slice.bucket, { records: slice.records, count: countKeys(slice.records) });
		}
		attempted = null;
	};

	const resetSnapshot = () => {
		diskMain = null;
		diskMeta = null;
		diskSlices = new Set();
		otherSlices = new Set();
		collections = new Map();
		attempted = null;
		corruptKeys = new Set();
	};

	/**
	 * The writes that bring the disk in line with `state`, and how to record
	 * them once done. Records always count. In "repair" mode, differences in
	 * this tab's own cursor, sync meta and settings don't.
	 */
	const plan = (state: PersistedState, mode: WriteMode) => {
		const ops: WriteOp[] = [];
		const nextCollections = new Map<Collection, CollectionSnap>();
		const slices = new Set(diskSlices);
		const data = (isRecord(state.data) ? state.data : {}) as Json;

		// ── Slices ──
		for (const collection of COLLECTIONS) {
			const sliceLayout = layoutOf(collection);
			if (sliceLayout === "main") continue;
			const map = (isRecord(data[collection]) ? data[collection] : {}) as Json;
			const snap = collections.get(collection);
			if (snap && snap.map === map) continue;
			const onDisk = snap?.buckets ?? new Map<string, BucketSnap>();
			// Pass 1: a bucket is dirty when one of its records isn't the object on
			// disk, or when the disk holds records that no longer belong to it
			// (moved to another year, removed, or duplicated by an older write).
			const dirty = new Set<string>();
			const matches = new Map<string, number>();
			for (const id in map) {
				const record = map[id];
				const bucket = bucketOf(sliceLayout, record);
				if (dirty.has(bucket)) continue;
				const disk = onDisk.get(bucket);
				if (disk?.records[id] !== record) dirty.add(bucket);
				else matches.set(bucket, (matches.get(bucket) ?? 0) + 1);
			}
			for (const [bucket, disk] of onDisk) {
				if (!dirty.has(bucket) && (matches.get(bucket) ?? 0) < disk.count) dirty.add(bucket);
			}
			const buckets = new Map(onDisk);
			if (dirty.size) {
				// Pass 2: serialize only the dirty buckets.
				const groups = new Map<string, Json>();
				for (const id in map) {
					const record = map[id];
					const bucket = bucketOf(sliceLayout, record);
					if (!dirty.has(bucket)) continue;
					let group = groups.get(bucket);
					if (!group) {
						group = {};
						groups.set(bucket, group);
					}
					group[id] = record;
				}
				for (const bucket of dirty) {
					const key = bucketKey(name, collection, bucket);
					const group = groups.get(bucket);
					if (group) {
						const snap: BucketSnap = { records: group, count: countKeys(group) };
						const fresh = diskSlices.has(key) ? undefined : { collection, snap };
						const disk = onDisk.get(bucket)?.records;
						ops.push({
							key,
							value: JSON.stringify(group),
							slice: { collection, bucket, snap, ...(disk ? { disk } : {}) },
							...(fresh ? { fresh } : {}),
						});
						slices.add(key);
						buckets.set(bucket, snap);
					} else {
						if (slices.has(key)) ops.push({ key, value: null });
						slices.delete(key);
						buckets.delete(bucket);
					}
				}
			}
			nextCollections.set(collection, { map, buckets });
		}

		const sync = (isRecord(state.sync) ? state.sync : emptySync()) as SyncMeta;
		const pending = splitPending(sync.pending);

		// Nothing on disk and nothing to keep (fresh install, after a reset): an
		// empty disk already means "defaults", so don't write them.
		if (!diskMain && !diskMeta && !ops.length && isPristine(state)) {
			return { ops: [] as WriteOp[], commit: () => {} };
		}

		// ── Main key ──
		const main = diskMain;
		const maps = new Map<string, unknown>();
		let mainDirty = !main || !main.exact;
		for (const collection of MAIN_COLLECTIONS) {
			const map = (isRecord(data[collection]) ? data[collection] : {}) as Json;
			maps.set(collection, map);
			if (mainDirty || main?.maps.get(collection) === map) continue;
			const disk = main?.records.get(collection);
			if (!disk) {
				mainDirty = true;
				continue;
			}
			let count = 0;
			for (const id in map) {
				if (disk.records[id] !== map[id]) {
					mainDirty = true;
					break;
				}
				count++;
			}
			if (!mainDirty && count !== disk.count) mainDirty = true;
		}
		const settings = settingsJson(state.settings);
		if (main && !mainDirty) {
			mainDirty =
				!containsAll(main.pending, pending.main) ||
				(mode === "normal" &&
					(settings !== main.settings ||
						sync.cursor !== main.cursor ||
						sync.lastSyncedAt !== main.lastSyncedAt ||
						pending.mainCount !== main.pending.size));
		}

		// ── Meta key ──
		const meta = diskMeta;
		const sliceList = [...slices].map(relative).sort();
		const dataRev = state.dataRev ?? SCHEMA_REV;
		const rest = restJson(sync);
		const foreign = foreignJson(state.foreign);
		let metaDirty =
			!meta ||
			sliceList.some((key) => !meta.slices.has(key)) ||
			!containsAll(meta.pending, pending.other) ||
			// The main key's cursor and its copy are written together.
			(mainDirty && meta.cursorCopy !== sync.cursor);
		if (meta && !metaDirty && mode === "normal") {
			metaDirty =
				meta.dataRev !== dataRev ||
				meta.rest !== rest ||
				meta.foreign !== foreign ||
				meta.cursorCopy !== sync.cursor ||
				meta.slices.size !== sliceList.length ||
				meta.pending.size !== pending.otherCount ||
				meta.settings !== settings;
		}

		let nextMain: MainSnap | null = main ? { ...main, maps } : null;
		const mainOps: WriteOp[] = [];
		/** The main key with `extra` records of sliced collections and the given cursor. */
		const mainValue = (extra: Json, cursor: unknown, lastSyncedAt: unknown): string => {
			const mainData: Json = {};
			for (const collection of MAIN_COLLECTIONS) mainData[collection] = maps.get(collection);
			Object.assign(mainData, extra);
			return JSON.stringify({
				state: {
					data: mainData,
					settings: state.settings,
					sync: { cursor, pending: pending.main, lastSyncedAt },
				},
				version,
			});
		};
		if (mainDirty) {
			const records = new Map<string, BucketSnap>();
			for (const collection of MAIN_COLLECTIONS) {
				const map = maps.get(collection) as Json;
				records.set(collection, { records: map, count: countKeys(map) });
			}
			mainOps.push({ key: layout.main, value: mainValue({}, sync.cursor, sync.lastSyncedAt) });
			nextMain = {
				records,
				maps,
				settings,
				cursor: sync.cursor,
				lastSyncedAt: sync.lastSyncedAt,
				pending: new Set(Object.keys(pending.main)),
				exact: true,
				legacy: new Map(),
			};
		}

		let nextMeta = meta;
		const metaOps: WriteOp[] = [];
		if (metaDirty) {
			const { cursor, pending: _pending, lastSyncedAt: _last, ...syncFields } = sync;
			metaOps.push({
				key: layout.meta,
				value: JSON.stringify({
					dataRev,
					sync: { ...syncFields, pending: pending.other, cursorCopy: cursor },
					foreign: state.foreign ?? {},
					slices: sliceList,
					settings: state.settings,
				}),
			});
			nextMeta = {
				dataRev,
				rest,
				cursorCopy: cursor,
				pending: new Set(Object.keys(pending.other)),
				foreign,
				slices: new Set(sliceList),
				settings,
			};
		}

		const commit = () => {
			diskMain = nextMain;
			diskMeta = nextMeta;
			diskSlices = slices;
			for (const [collection, snap] of nextCollections) collections.set(collection, snap);
		};

		// Meta first: it lists the slices, so a slice is never on disk unlisted.
		// The main key last: it holds the cursor, which must never move past
		// records that are not on disk yet.
		//
		// A main key in an older layout still holds records of sliced
		// collections (a v1 build's logs). Replacing it only at the end would
		// need room for the data twice (every slice next to the old main key),
		// which a localStorage quota may not have. Instead, each of those
		// buckets is written, then the main key is rewritten without it (and
		// without the buckets written before): the disk is complete at every
		// step and holds at most one bucket twice. The in-between main keys keep
		// the cursor that is on disk.
		//
		// A bucket that doesn't fit next to the old main key (all the logs in
		// one year) is moved in halves instead, recursively: half of its records
		// go into the slice, the main key is rewritten without them, then the
		// rest. The peak is then the data plus the largest piece that fits.
		const legacy = main && !main.exact && mainDirty ? main.legacy : null;
		const steps = legacy
			? ops.filter((op) => op.slice && legacy.get(op.slice.collection)?.has(op.slice.bucket))
			: [];
		if (!main || !steps.length) return { ops: [...metaOps, ...ops, ...mainOps], commit };
		const inSteps = new Set(steps);
		// The biggest buckets first: the in-between main keys shrink fastest.
		steps.sort((a, b) => (b.slice?.snap.count ?? 0) - (a.slice?.snap.count ?? 0));

		/**
		 * Per step: "done" once its slice is complete; otherwise the ids moved
		 * into the slice so far (absent: not started).
		 */
		const progress = new Map<WriteOp, Set<string> | "done">();
		const sliceOf = (op: WriteOp) => op.slice as NonNullable<WriteOp["slice"]>;
		/** The main key in between: the records of every bucket not yet in its slice. */
		const between = (): WriteOp => ({
			key: layout.main,
			value: null,
			lazy: () => {
				const extra: Json = {};
				for (const step of steps) {
					const moved = progress.get(step);
					if (moved === "done") continue;
					const { collection, snap, disk } = sliceOf(step);
					if (!isRecord(extra[collection])) extra[collection] = {};
					const target = extra[collection] as Json;
					for (const id in snap.records) {
						// Once a piece is written, the slice holds the disk's records too.
						if (moved && (moved.has(id) || (disk && id in disk))) continue;
						target[id] = snap.records[id];
					}
				}
				return mainValue(extra, main.cursor, main.lastSyncedAt);
			},
		});
		/** Writes `piece` (ids) of a step's bucket into its slice, after what is there. */
		const movePiece = (step: WriteOp, piece: readonly string[]): WriteOp => ({
			key: step.key,
			value: null,
			lazy: () => {
				const moved = progress.get(step);
				const { snap, disk } = sliceOf(step);
				const take = new Set(piece);
				const out: Json = {};
				for (const id in snap.records) {
					const keep =
						(disk && id in disk) || take.has(id) || (moved instanceof Set && moved.has(id));
					if (keep) out[id] = snap.records[id];
				}
				return JSON.stringify(out);
			},
			split: () => halves(step, piece),
			done: () => {
				const moved = progress.get(step);
				if (moved === "done") return;
				const next = moved ?? new Set<string>();
				for (const id of piece) next.add(id);
				progress.set(step, next);
			},
		});
		/** A piece too big to write at once: its first half, the main key, its second half. */
		const halves = (step: WriteOp, piece: readonly string[]): WriteOp[] | null => {
			if (piece.length < 2) return null;
			const { snap } = sliceOf(step);
			const date = (id: string) => {
				const record = snap.records[id];
				return isRecord(record) && typeof record.date === "string" ? record.date : "";
			};
			// By date, so each half is a run of days (whole months, mostly).
			const sorted = [...piece].sort((a, b) => {
				const x = date(a);
				const y = date(b);
				return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
			});
			const middle = Math.ceil(sorted.length / 2);
			return [
				movePiece(step, sorted.slice(0, middle)),
				between(),
				movePiece(step, sorted.slice(middle)),
			];
		};

		const ordered: WriteOp[] = [...metaOps, ...ops.filter((op) => !inSteps.has(op))];
		steps.forEach((op, i) => {
			op.done = () => progress.set(op, "done");
			op.split = () => {
				// Everything the slice doesn't hold yet (read at failure time: a fresh
				// slice's disk records were merged in by then).
				const { snap, disk } = sliceOf(op);
				const piece: string[] = [];
				for (const id in snap.records) if (!disk || !(id in disk)) piece.push(id);
				return halves(op, piece);
			};
			ordered.push(op);
			if (i < steps.length - 1) ordered.push(between());
		});
		return { ops: [...ordered, ...mainOps], commit };
	};

	const removeLegacy = async () => {
		const removal = legacyRemoval;
		if (!removal) return;
		const results = await Promise.allSettled(
			removal.keys.map((key) => call(() => removal.kv.removeItem(key))),
		);
		if (results.every((r) => r.status === "fulfilled") && legacyRemoval === removal) {
			legacyRemoval = null;
		}
	};

	/**
	 * Reads a slice this tab is about to create and merges what is already
	 * there into the write (records by `updatedAt`). Returns the records found.
	 */
	const mergeFresh = async (op: WriteOp & { fresh: NonNullable<WriteOp["fresh"]> }) => {
		// Hydration found it corrupt and backed it up: nothing there to merge.
		if (corruptKeys.has(op.key)) return null;
		const read = await readRaw(kv, op.key);
		if ("error" in read) throw read.error;
		const disk = parseStored(kv, op.key, read.raw);
		if (!disk || countKeys(disk) === 0) return null;
		const merged = lwwInto({ ...op.fresh.snap.records }, disk);
		op.value = JSON.stringify(merged);
		op.fresh.snap.records = merged;
		op.fresh.snap.count = countKeys(merged);
		if (op.slice) op.slice.disk = disk;
		return disk;
	};

	/**
	 * Plans and runs one write; records the result. Runs inside the queue.
	 * Keys are written one at a time, in plan order (meta, slices, main; see
	 * `plan` for an older main key), and the first failure stops the write, so
	 * a slice is never on disk while the meta key that lists it failed
	 * (backends write key by key, not atomically).
	 */
	const execute = async (state: PersistedState, mode: WriteMode): Promise<void> => {
		const { ops, commit } = plan(state, mode);
		const discovered: ExternalChanges = { data: {}, foreign: {}, pending: {} };
		let found = false;
		const run = async (op: WriteOp): Promise<void> => {
			if (op.fresh) {
				const disk = await mergeFresh(op as WriteOp & { fresh: NonNullable<WriteOp["fresh"]> });
				if (disk) {
					const collection = op.fresh.collection;
					discovered.data[collection] = { ...discovered.data[collection], ...disk };
					found = true;
				}
			}
			const key = op.key;
			const value = op.lazy ? op.lazy() : op.value;
			try {
				await call(() => (value === null ? kv.removeItem(key) : kv.setItem(key, value)));
			} catch (error) {
				// A migration step that doesn't fit (a full localStorage): in smaller
				// pieces. Nothing was written (a failed setItem keeps the old value).
				const pieces = op.split?.();
				if (!pieces) throw error;
				for (const piece of pieces) await run(piece);
				op.done?.();
				return;
			}
			// Replaced: no longer the corrupt payload hydration found.
			corruptKeys.delete(key);
			op.done?.();
		};
		for (const op of ops) {
			try {
				await run(op);
			} catch (error) {
				reportError(error);
				return;
			}
		}
		commit();
		if (found) {
			console.warn("[atomic] Found stored records this tab hadn't read; merged them");
			try {
				options.onDiscovered?.(discovered);
			} catch {
				// a listener must not break persistence
			}
		}
		if (legacyRemoval) await removeLegacy();
		try {
			options.onSaved?.([...new Set(ops.map((op) => op.key))]);
		} catch {
			// a listener must not break persistence
		}
	};

	const write = (): Promise<void> => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		return enqueue(async () => {
			const value = pendingValue;
			pendingValue = null;
			if (!value || readOnly || !ready) {
				if (value && !readOnly) pendingValue = value;
				return;
			}
			const state = value.state;
			const parts = [state.data, state.settings, state.sync, state.foreign, state.dataRev];
			// Nothing changed since the last attempt (also stops a failing write from looping).
			if (!force && sameParts(attempted, parts)) return;
			force = false;
			attempted = parts;
			await execute(state, "normal");
		});
	};

	/** Hydration: everything joined; the legacy backend merged in or migrated from. */
	const finish = (
		read: LayoutRead,
		legacy: { kv: KeyValueStorage; read: LayoutRead } | null,
	): StorageValue<PersistedState> | null => {
		if (read.error !== undefined) {
			readOnly = true;
			console.warn("[atomic] Could not read stored data; changes stay in memory", read.error);
			reportError(read.error);
		}
		seedSnapshot(read);
		corruptKeys = new Set(read.corrupt);
		let state: JoinedState | null = hasContent(read) ? joinLayout(read) : null;
		if (legacy && legacy.read.error === undefined) {
			const content = hasContent(legacy.read);
			// Corrupt legacy keys were backed up there; removed with the rest.
			if (content || legacy.read.corrupt.length) {
				legacyRemoval = {
					kv: legacy.kv,
					keys: [
						...new Set([
							name,
							metaKey(name),
							...legacy.read.slices.map((s) => s.key),
							...legacy.read.corrupt,
						]),
					],
				};
			}
			if (content) {
				const older = joinLayout(legacy.read);
				// First run on IndexedDB: hydrate from localStorage, write everything, then remove it.
				// Later: a stale v1 tab wrote it again; merge by record and remove it again.
				state = state ? mergeJoined(state, normalizeJoined(older)) : older;
			}
		}
		const unreadable = read.error !== undefined || legacy?.read.error !== undefined;
		const corrupt = [...read.corrupt, ...(legacy?.read.corrupt ?? [])];
		if (corrupt.length) {
			console.warn("[atomic] Some stored data was corrupt and was backed up", corrupt);
			// Their records may be on the server: the next sync re-pulls everything.
			if (state?.sync) state = { ...state, sync: { ...state.sync, schemaRev: 1 } };
		}
		if (unreadable || corrupt.length) {
			try {
				options.onIncomplete?.({ unreadable, corrupt });
			} catch {
				// a listener must not break hydration
			}
		}
		ready = true;
		// A value set before hydration is the empty initial state: writing it would
		// replace the data just read. The hydrated state is written next.
		pendingValue = null;
		return state ? { state: state as unknown as PersistedState, version } : null;
	};

	const readLegacyLayout = async (): Promise<{ kv: KeyValueStorage; read: LayoutRead } | null> => {
		if (!isMigratingStorage(kv)) return null;
		try {
			const legacyKv = await kv.legacy();
			if (!legacyKv) return null;
			return { kv: legacyKv, read: await readLayout(legacyKv, name) };
		} catch {
			return null;
		}
	};

	const purge = (): Promise<void> =>
		enqueue(async () => {
			const keys = new Set<string>([layout.main, layout.meta, ...diskSlices, ...otherSlices]);
			if (kv.keys) {
				const found = await kv.keys(layout.slicePrefix).catch(() => [] as string[]);
				for (const key of found) keys.add(key);
			}
			const removals = [...keys].map((key) => call(() => kv.removeItem(key)));
			const legacy = await readLegacyLayout();
			if (legacy) {
				const legacyKeys = new Set([
					name,
					metaKey(name),
					...legacy.read.slices.map((s) => s.key),
					...legacy.read.otherSlices,
				]);
				for (const key of legacyKeys) removals.push(call(() => legacy.kv.removeItem(key)));
			}
			const results = await Promise.allSettled(removals);
			const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
			if (failure) reportError(failure.reason);
			legacyRemoval = null;
			resetSnapshot();
		});

	const changesFrom = (state: JoinedState): ExternalChanges => {
		const changes: ExternalChanges = { data: {}, foreign: {}, pending: {} };
		for (const [collection, records] of Object.entries(state.data)) {
			if (isKnownCollection(collection) && isRecord(records)) changes.data[collection] = records;
		}
		for (const [collection, records] of Object.entries(state.foreign)) {
			if (!isRecord(records)) continue;
			if (isKnownCollection(collection)) {
				changes.data[collection] = lwwInto({ ...(changes.data[collection] ?? {}) }, records);
			} else changes.foreign[collection] = records;
		}
		const pending = state.sync?.pending;
		if (isRecord(pending)) {
			for (const key in pending) if (pending[key] === true) changes.pending[key] = true;
		}
		return changes;
	};

	return {
		layout,

		// Stays synchronous for synchronous backends so the first render has the data.
		getItem() {
			return chain(readLayout(kv, name), (read) =>
				isMigratingStorage(kv)
					? readLegacyLayout().then((legacy) => finish(read, legacy))
					: finish(read, null),
			);
		},

		setItem(_name, value) {
			pendingValue = value;
			if (!ready || readOnly) return;
			if (debounceMs <= 0) {
				void write();
				return;
			}
			if (!timer) {
				timer = setTimeout(() => {
					timer = null;
					void write();
				}, debounceMs);
			}
		},

		removeItem: () => purge(),

		flush() {
			if (timer || pendingValue) return write();
			return enqueue(async () => {});
		},

		readKeys(keys, current) {
			return enqueue(async () => {
				if (!ready || readOnly) return null;
				const wanted = [...new Set(keys)].filter(
					(key) => key === layout.main || key === layout.meta || parseSliceKey(name, key),
				);
				if (!wanted.length) return null;
				const results = await readAll(kv, wanted);
				const read = emptyRead();
				// Records equal to ours keep our object, so they don't look dirty.
				const live = current().data as unknown as Record<string, Json | undefined>;
				const align: Align = (collection, records) => {
					const mine = live[collection] ?? {};
					const out: Json = {};
					for (const id in records) {
						const disk = records[id];
						const own = mine[id];
						// Same version (the sync order's equality: same stamp, same content).
						const same = own !== undefined && own !== disk && compareVersions(own, disk) === 0;
						out[id] = same ? own : disk;
					}
					return out;
				};
				let any = false;
				wanted.forEach((key, i) => {
					const result = results[i];
					if (!result || "error" in result) return;
					any = true;
					const value = parseStored(kv, key, result.raw);
					if (key === layout.main) {
						diskMain = value ? mainSnapOf(value, align) : null;
						read.main = value;
						return;
					}
					if (key === layout.meta) {
						diskMeta = value ? metaSnapOf(value) : null;
						read.meta = value;
						for (const listed of listedSlices(name, value)) {
							if (parseSliceKey(name, listed)) diskSlices.add(listed);
						}
						return;
					}
					const slice = parseSliceKey(name, key);
					if (!slice) return;
					let snap = collections.get(slice.collection);
					if (!snap) {
						snap = { map: null, buckets: new Map() };
						collections.set(slice.collection, snap);
					}
					snap.map = null;
					if (!value) {
						diskSlices.delete(key);
						snap.buckets.delete(slice.bucket);
						return;
					}
					diskSlices.add(key);
					const aligned = align(slice.collection, value);
					snap.buckets.set(slice.bucket, { records: aligned, count: countKeys(aligned) });
					read.slices.push({ key, ...slice, records: value });
				});
				if (!any) return null;
				const changes = changesFrom(joinLayout(read));
				if (read.main && isRecord(read.main.state)) changes.settings = read.main.state.settings;
				return changes;
			});
		},

		repair(value) {
			return enqueue(async () => {
				if (!ready || readOnly) return;
				await execute(value.state, "repair");
			});
		},

		readLegacy() {
			return enqueue(async () => {
				if (!ready || readOnly) return null;
				const legacy = await readLegacyLayout();
				if (!legacy || !hasContent(legacy.read) || legacy.read.error !== undefined) return null;
				legacyRemoval = {
					kv: legacy.kv,
					keys: [name, metaKey(name), ...legacy.read.slices.map((s) => s.key)],
				};
				// Written (and then removed) even when it brings nothing new.
				force = true;
				return changesFrom(normalizeJoined(joinLayout(legacy.read)));
			});
		},

		purge,

		dropCorrupt() {
			return enqueue(async () => {
				if (!ready || readOnly || !corruptKeys.size) return;
				const keys = [...corruptKeys];
				const results = await Promise.allSettled(keys.map((key) => call(() => kv.removeItem(key))));
				results.forEach((result, i) => {
					if (result.status === "fulfilled") corruptKeys.delete(keys[i] as string);
				});
				const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
				if (failure) reportError(failure.reason);
			});
		},

		lock() {
			readOnly = true;
			pendingValue = null;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		},
	};
}
