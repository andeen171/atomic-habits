import { persist } from "zustand/middleware";
import { type StoreApi, createStore } from "zustand/vanilla";
import { type CloudActions, createCloudActions } from "./actions/cloud";
import { type HabitV2Actions, createHabitV2Actions, nextGoalHistory } from "./actions/habits-v2";
import { type JournalActions, createJournalActions } from "./actions/journal";
import { type TaskActions, createTaskActions, legacySeriesWrites } from "./actions/tasks";
import { DEFAULT_HABIT_EMOJI, autoHabitEmoji } from "./content";
import { type DayKey, toDayKey } from "./dates";
import { buildDemoData } from "./demo";
import { sameGoal, targetOn } from "./habits";
import { type Locale, type Translator, createTranslator, resolveLocale } from "./i18n";
import { createId } from "./ids";
import { taskLogIndexOf, trackerEntryIndexOf } from "./indexes";
import {
	type AtomicData,
	COLLECTIONS,
	type Collection,
	DEFAULT_SETTINGS,
	EXPORT_COLLECTIONS,
	EXPORT_FORMAT,
	EXPORT_VERSION,
	type EntityByCollection,
	type ExportFile,
	type Habit,
	type HabitLog,
	type Identity,
	SCHEMA_REV,
	type ScorecardItem,
	type Settings,
	type Task,
	type TaskLog,
	collectionSchemas,
	emptyData,
	exportFileSchema,
	habitSchema,
	identitySchema,
	logId,
	scorecardItemSchema,
	settingsSchema,
	taskLogId,
	taskSchema,
} from "./model";
import {
	type ExternalChanges,
	type ForeignData,
	type HydrationGaps,
	type PersistedState,
	type SyncMeta,
	createSplitStorage,
	emptySync,
	hydratePersisted,
	isKnownCollection,
	layoutKeyOf,
	logNormalization,
	unionRecovery,
} from "./persist-layout";
import { anchorOf, isKnownRule, isLegacyCheckoff, sanitizeRepeat, seriesState } from "./recurrence";
import { type KeyValueStorage, createMemoryStorage } from "./storage";
import {
	type WireSyncRecord,
	canonicalJson,
	compareVersions,
	parsePendingKey,
	pendingKey,
	shouldReplace,
} from "./sync";
import { type TrackerActions, createTrackerActions } from "./trackers/actions";
import { type HabitDay, buildTrackerEntryIndex, pairsForHabit } from "./trackers/measure";
import {
	TRACKER_META,
	isForeignTracker,
	isTrackerDay,
	knownTracker,
	normalizeTrackerChange,
	trackerCountKey,
	trackerStart,
} from "./trackers/meta";
import { plannedLogs, reconcilePlan, reconcileWindow } from "./trackers/reconcile";
import type { AnyTrackerConfig, TrackerConfigInput } from "./trackers/schema";
import { upgradeRecord } from "./upgrade";

type Editable<T> = Omit<T, "id" | "createdAt" | "updatedAt" | "deletedAt">;

/** A habit as callers write it: the tracker may be an input config (defaults are applied by the store). */
type HabitFields = Omit<Editable<Habit>, "tracker"> & {
	tracker: AnyTrackerConfig | TrackerConfigInput | null;
};
export type HabitInput = Partial<HabitFields> & { name: string };
export type HabitPatch = Partial<HabitFields>;
export type IdentityInput = Partial<Editable<Identity>> & { statement: string };
export type IdentityPatch = Partial<Editable<Identity>>;
export type TaskInput = Partial<Editable<Task>> & { title: string };
export type TaskPatch = Partial<Editable<Task>>;
export type ScorecardInput = Partial<Editable<ScorecardItem>> & { label: string };
export type ScorecardPatch = Partial<Editable<ScorecardItem>>;

export interface ImportResult {
	ok: boolean;
	/** Records written (merge: newer than the local copy; replace: every valid record). */
	imported: number;
	/** Records that failed validation, or whose key is superseded (spec §2.8). */
	skipped: number;
	error?: string;
}

/** Who caused a commit (D56). Celebrations and haptics react only to `"local"`. */
export type CommitOrigin = "local" | "remote" | "derived";
/** Whole entities per collection, as written by one commit. */
export type CommitChanges = Partial<{ [C in Collection]: EntityByCollection[C][] }>;
export interface CommitEvent {
	origin: CommitOrigin;
	changes: CommitChanges;
}

export interface ApplyRemoteOptions {
	/**
	 * Run tracker and legacy-series reconciliation for what this call touched
	 * (default true: the artifact path). The sync engine passes false and
	 * reconciles once after a completed pull (spec §2.7 step 7).
	 */
	reconcile?: boolean;
	/** Origin of the commit event (default `"remote"`). */
	origin?: CommitOrigin;
}

export interface ApplyRemoteResult {
	/** Documents that replaced the local copy. */
	applied: number;
	/** Habit-days to reconcile: applied tracker entries (old and new day) and changed trackers. */
	pairs: HabitDay[];
	/** Applied series a v1 client checked off (`completedAt` without a matching `repeat.endedAt`). */
	series: string[];
}

/**
 * What action modules (`actions/*.ts`, `trackers/actions.ts`) get from the
 * store (spec §3.1). They never call zustand's `set` directly.
 */
export interface StoreInternals {
	get(): AtomicState;
	/** The device clock (day keys stay on local time). */
	now(): number;
	today(): DayKey;
	settings(): Settings;
	/** Translator for the resolved app locale (setting, then device locales). */
	translator(): Translator;
	/**
	 * `updatedAt` for a write: the corrected clock (`now() + clockOffsetMs`),
	 * and never below `prev.updatedAt + 1`, so an edit always beats the version
	 * it edits (D45).
	 */
	stamp(prev?: { updatedAt: number }): number;
	/** Schema-checks a candidate; `{...candidate, ...parsed}` or null (warned). */
	validated<C extends Collection>(c: C, candidate: unknown): EntityByCollection[C] | null;
	/**
	 * One `set()`. Marks pending keys only while `sync.tracking` (and never
	 * for origin `"remote"`). A `"local"` commit that touches a superseded key
	 * is refused as a whole and emits a `superseded` notice; `"derived"`
	 * commits drop superseded records silently.
	 */
	commit(changes: CommitChanges, opts?: { origin?: CommitOrigin }): void;
	notify(notice: StoreNotice): void;
}

/** The actions `store.ts` itself defines: v1 actions, persistence and the sync hooks. */
export interface StoreActions {
	createHabit(input: HabitInput): Habit;
	updateHabit(id: string, patch: HabitPatch): void;
	/**
	 * Undo of a tracker setup saved in the app ("Tracker attached · Undo"):
	 * the habit's tracker, target and unit go back exactly as they were (a
	 * habit that had no tracker has none again, not a disabled one), and its
	 * entry days follow, in one commit. Goal history rules apply as in
	 * `updateHabit`.
	 */
	restoreTrackerSetup(id: string, before: Pick<Habit, "tracker" | "target" | "unit">): void;
	archiveHabit(id: string, archived?: boolean): void;
	deleteHabit(id: string): void;
	restoreHabit(id: string): void;
	reorderHabits(ids: string[]): void;

	/** Set the repetitions (build) or slips (break) for a day. */
	setCount(habitId: string, date: DayKey, count: number): void;
	increment(habitId: string, date: DayKey, delta?: number): void;
	/** Build habits: jump between 0 and the daily target. */
	toggleHabit(habitId: string, date: DayKey): void;
	setSkipped(habitId: string, date: DayKey, skipped: boolean): void;
	setNote(habitId: string, date: DayKey, note: string | null): void;

	createIdentity(input: IdentityInput): Identity;
	updateIdentity(id: string, patch: IdentityPatch): void;
	deleteIdentity(id: string): void;

	createTask(input: TaskInput): Task;
	updateTask(id: string, patch: TaskPatch): void;
	toggleTask(id: string): void;
	deleteTask(id: string): void;
	restoreTask(id: string): void;
	clearCompletedTasks(): void;

	createScorecardItem(input: ScorecardInput): ScorecardItem;
	updateScorecardItem(id: string, patch: ScorecardPatch): void;
	deleteScorecardItem(id: string): void;
	reorderScorecard(ids: string[]): void;

	updateSettings(patch: Partial<Settings>): void;
	/** Export file version 2 with every collection (spec §2.8). */
	exportData(): ExportFile;
	/**
	 * Imports a version 1 or 2 backup (spec §2.8). Each record goes through
	 * `upgradeRecord` and its schema and is stored as `{...raw, ...parsed}`;
	 * invalid ones are skipped. `"replace"` replaces only the collections the
	 * file's version can contain (a v1 backup never touches the journal,
	 * task logs or tracker entries).
	 */
	importData(file: unknown, mode?: "merge" | "replace"): ImportResult;
	/** Replace everything with a realistic sample history (for exploring). */
	loadDemoData(locale?: string): void;
	/** Wipe all local data and settings on this device (every persisted key). */
	resetAll(): void;
	/**
	 * Wipe data, sync state and unknown collections; keep settings; write no
	 * tombstones. `sync.tracking` and `sync.clockOffsetMs` describe the
	 * session and the device clock, not the data, so they are kept.
	 */
	clearLocalData(): void;

	/**
	 * Merge documents pulled from the sync server (or the artifact cloud).
	 * Each record goes through `upgradeRecord` and its schema; a newer one
	 * this build can't parse is recorded in `sync.superseded` and the local
	 * copy is kept (spec §2.7). Records of unknown collections are skipped.
	 */
	applyRemote(records: readonly WireSyncRecord[], opts?: ApplyRemoteOptions): ApplyRemoteResult;
	setSyncMeta(patch: Partial<SyncMeta>): void;
}

export type AtomicActions = StoreActions &
	HabitV2Actions &
	CloudActions &
	TaskActions &
	JournalActions &
	TrackerActions;

export interface PersistError {
	at: number;
	message: string;
}

export interface AtomicState {
	data: AtomicData;
	settings: Settings;
	sync: SyncMeta;
	/** Collections written by a newer build, kept verbatim and written back (spec §2.6.3). */
	foreign: ForeignData;
	/** The last local write failed (in memory only). The apps show a blocking banner. */
	persistError: PersistError | null;
	/** True once persisted state has been loaded. */
	hydrated: boolean;
	/**
	 * Hydration could not read every stored key (a read failed, a key was
	 * corrupt, or hydration threw), so `data` may lack records that exist on
	 * disk or on the server. Not persisted itself:
	 * - A failed read or a failed hydration lasts for the session (nothing is
	 *   written then), and a later session that reads every key starts without it.
	 * - A corrupt key starts a recovery that is persisted (`SyncMeta.recovering`):
	 *   every session is partial until the re-pull it requested completed (at once
	 *   when not tracking). Records created meanwhile over a record that lived in
	 *   the corrupt key are rebased onto the server's copy when it arrives.
	 *
	 * While set, nothing derived from the missing records may leave the
	 * device: derived writers are no-ops (tracker and legacy-series
	 * reconciliation at start, day change, after a pull and after import;
	 * `applyTranslations`, `pruneTranslations`; blob GC, T5), and the sync
	 * engine holds every push (pulls still run). Otherwise a log rebuilt from
	 * its tracker entries, with its note gone, would replace the server's copy.
	 */
	partial: boolean;
	actions: AtomicActions;
}

/**
 * Events the UI reacts to without them being state (toasts, banners).
 * `superseded`: a local edit was refused because a newer version of Atomic
 * wrote that document (toast `sync.superseded`).
 */
export type StoreNotice =
	| { type: "persist-error"; message: string }
	| { type: "superseded"; key: string };

export type AtomicStore = StoreApi<AtomicState> & {
	/** Persist pending writes now (call when the app goes to background). */
	flush(): Promise<void>;
	/** Every data commit with its origin (D56): month celebrations listen to `"local"` only. */
	subscribeCommits(listener: (commit: CommitEvent) => void): () => void;
	subscribeNotices(listener: (notice: StoreNotice) => void): () => void;
	/** Stops cross-tab listening (tests, hot reload). */
	dispose(): void;
};

/** The part of `BroadcastChannel` the store uses; tests pass a fake. */
export interface CrossTabChannel {
	postMessage(message: unknown): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
	removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
	close?(): void;
}

export interface CreateStoreOptions {
	/** Key/value backend: IndexedDB on the web, expo-sqlite kv on native, memory in tests. */
	storage?: KeyValueStorage;
	/** Storage key (prefix of every layout key). */
	name?: string;
	now?: () => number;
	debounceMs?: number;
	/**
	 * Web: merge what other tabs write (spec §2.6.5). `true` opens
	 * `BroadcastChannel(name)` and also listens for a stale v1 tab writing the
	 * legacy localStorage key; tests pass a channel. Off by default.
	 */
	crossTab?: boolean | CrossTabChannel;
	/**
	 * The device's preferred languages, for the "system" locale. Defaults to
	 * `navigator.languages ?? []`; native passes expo-localization's tags.
	 */
	deviceLocales?: () => readonly string[];
}

export const STORE_VERSION = 1;

/**
 * Icons of `emojiAuto` habits follow their live identity's emoji, else the
 * kind default (spec §2.3). Runs after hydration, `applyRemote` and import.
 * The write is not stamped and not marked pending: it is a pure function of
 * synced data, so every device derives the same icon. Returns `data` itself
 * when nothing changes. Never throws: it runs inside hydration's `merge` and
 * `applyRemote`, over raw records that may be invalid (rule 2); a habit it
 * can't derive keeps its icon.
 */
export function deriveAutoEmojis(data: AtomicData): AtomicData {
	let habits: Record<string, Habit> | null = null;
	for (const [id, habit] of Object.entries(data.habits)) {
		try {
			if (!habit || typeof habit !== "object") continue;
			if (habit.deletedAt || habit.emojiAuto !== true) continue;
			const identityId = typeof habit.identityId === "string" ? habit.identityId : null;
			const identity = identityId ? data.identities[identityId] : undefined;
			const emoji = autoHabitEmoji(
				habit.kind,
				identity && typeof identity === "object" && !identity.deletedAt ? identity.emoji : null,
			);
			if (habit.emoji === emoji) continue;
			habits ??= { ...data.habits };
			habits[id] = { ...habit, emoji };
		} catch (error) {
			console.warn("[atomic] Could not derive the icon of habit", id, error);
		}
	}
	return habits ? { ...data, habits } : data;
}

type Json = Record<string, unknown>;

const isJson = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A local record as the server sees it when this device pushes it: the
 * entity as `data`, merged with its envelope (`validateWireRecord`).
 */
const wireOf = (record: Json): Json => ({
	...record,
	id: record.id,
	updatedAt: record.updatedAt,
	deletedAt: record.deletedAt ?? null,
});

/**
 * The same version as this build stores it. The icon of an auto-icon habit
 * is derived on each device (`deriveAutoEmojis`), so it never makes two
 * copies differ.
 */
function sameVersion(collection: string, a: Json, b: Json): boolean {
	if (compareVersions(a, b) === 0) return true;
	if (collection !== "habits" || a.emojiAuto !== true || b.emojiAuto !== true) return false;
	return compareVersions({ ...a, emoji: null }, { ...b, emoji: null }) === 0;
}

/**
 * Whether a version from the server replaces the local copy (last-write-wins,
 * spec §2.7, D45). `wire` is the record as the server stored and compared it
 * (`data` plus the envelope, before `upgradeRecord` and the schema);
 * `normalized` is what this build would store (null when it can't parse it).
 *
 * - Different stamps: the greater one wins.
 * - The same version (it normalizes to the local copy): nothing to do, so a
 *   re-pull of an older build's documents applies nothing.
 * - Equal stamps, the local copy pending: the sync order on the wire forms.
 *   That is exactly the comparison the server makes when this device pushes
 *   its copy, so the two always agree. Comparing the normalized copy instead
 *   can disagree for a document an older build wrote (it lacks fields that
 *   normalization adds): the device would keep its copy, clear the key and
 *   stay out of step with the server for good.
 * - Equal stamps, nothing pending: the server's copy. This device has no
 *   claim on the document, and the server already ordered the versions it
 *   saw (a normalized local copy of an older build's document doesn't
 *   compare the way the stored one did).
 */
function remoteReplaces(
	collection: string,
	current: Json | undefined,
	wire: Json,
	normalized: Json | null,
	pending: boolean,
): boolean {
	if (current === undefined) return true;
	if (wire.updatedAt !== current.updatedAt) return compareVersions(wire, current) > 0;
	if (normalized && sameVersion(collection, normalized, current)) return false;
	const order = compareVersions(wire, wireOf(current));
	if (order === 0) return false;
	return pending ? order > 0 : true;
}

/** Values a record created from nothing holds for fields nobody set. */
const isBlank = (value: unknown): boolean =>
	value === null ||
	value === undefined ||
	value === false ||
	value === 0 ||
	value === "" ||
	(Array.isArray(value) && value.length === 0) ||
	(isJson(value) && Object.keys(value).length === 0);

const ENVELOPE = new Set(["id", "createdAt", "updatedAt", "deletedAt"]);

/**
 * A record created over a missing base while recovering (`SyncRecovery`),
 * rebased onto the server's copy: the server's fields, with the ones the
 * user set on top (the local record's non-blank fields: it started from
 * nothing, so its blank fields are defaults, not edits). It keeps the local
 * stamp, so it still wins last-write-wins and is pushed.
 */
function rebaseProvisional(server: Json, local: Json): Json {
	const out: Json = { ...server };
	for (const key in local) {
		if (ENVELOPE.has(key) || isBlank(local[key])) continue;
		out[key] = local[key];
	}
	out.updatedAt = local.updatedAt;
	out.deletedAt = local.deletedAt ?? null;
	return out;
}

/** At most this many records keep retired versions (they are sent with every announcement). */
const MAX_RETIRED = 200;
/** At most this many settled pending keys are remembered (see `settled`). */
const MAX_SETTLED = 50_000;

/** FNV-1a (32 bits) of a string, base 36. */
function fnv1a(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

const versionIds = new WeakMap<object, string>();

/**
 * A short id of a record's version: its stamp and a hash of its content in
 * the sync order's terms (`sameVersion`); "-" for no record. Records are
 * never mutated, so it is cached per object.
 */
function versionId(collection: string, record: unknown): string {
	if (!isJson(record)) return "-";
	let id = versionIds.get(record);
	if (id === undefined) {
		const comparable =
			collection === "habits" && record.emojiAuto === true ? { ...record, emoji: null } : record;
		id = `${String(record.updatedAt)}:${fnv1a(canonicalJson(comparable))}`;
		versionIds.set(record, id);
	}
	return id;
}

/** The collection of a pending key (`collection/id`). */
const collectionOfKey = (key: string): string => {
	const slash = key.indexOf("/");
	return slash < 0 ? key : key.slice(0, slash);
};

/** A record of a known collection by its pending key. */
function recordAt(data: AtomicData, key: string): unknown {
	const parsed = parsePendingKey(key);
	return parsed ? (data[parsed.collection] as Record<string, unknown>)[parsed.id] : undefined;
}

const partialize = (state: AtomicState): PersistedState => ({
	data: state.data,
	settings: state.settings,
	sync: state.sync,
	foreign: state.foreign,
	dataRev: SCHEMA_REV,
});

function openChannel(
	option: CreateStoreOptions["crossTab"],
	name: string,
): { channel: CrossTabChannel; owned: boolean } | null {
	if (!option) return null;
	if (option !== true) return { channel: option, owned: false };
	const Channel = (globalThis as { BroadcastChannel?: new (name: string) => CrossTabChannel })
		.BroadcastChannel;
	if (typeof Channel !== "function") return null;
	try {
		return { channel: new Channel(name), owned: true };
	} catch {
		return null;
	}
}

const clean = (value: string | null | undefined): string | null => {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : null;
};

function sanitizeHabit<T extends HabitPatch>(patch: T): T {
	// The store owns the goal history (Annex H §2.3): patches never write it.
	const { goalHistory: _owned, ...rest } = patch;
	const out = rest as T;
	if (typeof out.name === "string") out.name = out.name.trim();
	for (const key of [
		"unit",
		"cueLocation",
		"stackAfter",
		"bundle",
		"twoMinute",
		"reward",
		"environment",
		"why",
	] as const) {
		if (key in out) out[key] = clean(out[key]);
	}
	if (out.target != null) out.target = Math.max(1, Math.min(10_000, Math.round(out.target)));
	return out;
}

function nextOrder(records: Record<string, { order: number; deletedAt: number | null }>): number {
	let max = -1;
	for (const r of Object.values(records)) if (!r.deletedAt && r.order > max) max = r.order;
	return max + 1;
}

/** Habit fields with text the user typed: an edit of one stamps a missing `lang` (D44). */
const HABIT_TEXT_FIELDS = [
	"name",
	"unit",
	"cueLocation",
	"stackAfter",
	"bundle",
	"twoMinute",
	"reward",
	"environment",
	"why",
] as const;

/**
 * Tracker fields whose change re-derives a habit's entry days (spec §3.1,
 * Amends K): type, enabled, since, and how it counts a day (a change of the
 * latter moves `since` too; without it, from an older build, every entry day
 * is recounted so history never mixes two units).
 */
function trackerShape(habit: Habit | undefined): string {
	const tracker = habit?.tracker as { type?: unknown; enabled?: unknown; since?: unknown } | null;
	if (!tracker) return "";
	return JSON.stringify([tracker.type, tracker.enabled, tracker.since, trackerCountKey(tracker)]);
}

/**
 * A day a tracker from a newer build owns (unknown type): read-only for
 * logging here (Annex K §1.3). Earlier days keep their manual logs.
 */
function foreignTrackerDay(habit: Habit, date: DayKey): boolean {
	return !habit.deletedAt && isForeignTracker(habit) && date >= trackerStart(habit);
}

function isEmpty(record: object): boolean {
	for (const _ in record) return false;
	return true;
}

const defaultDeviceLocales = (): readonly string[] =>
	(globalThis as { navigator?: { languages?: readonly string[] } }).navigator?.languages ?? [];

/** Emits to every listener; a throwing listener never breaks the others or the caller. */
function emit<T>(listeners: ReadonlySet<(value: T) => void>, value: T, what: string): void {
	for (const listener of listeners) {
		try {
			listener(value);
		} catch (error) {
			console.error(`[atomic] ${what} listener failed`, error);
		}
	}
}

export function createAtomicStore(options: CreateStoreOptions = {}): AtomicStore {
	const now = options.now ?? Date.now;
	const name = options.name ?? "atomic-habits";
	const kv = options.storage ?? createMemoryStorage();
	const deviceLocales = options.deviceLocales ?? defaultDeviceLocales;
	const noticeListeners = new Set<(notice: StoreNotice) => void>();
	const commitListeners = new Set<(commit: CommitEvent) => void>();
	const notify = (notice: StoreNotice) => emit(noticeListeners, notice, "Notice");
	const emitCommit = (commit: CommitEvent) => emit(commitListeners, commit, "Commit");
	const translators = new Map<Locale, Translator>();
	// Assigned inside the store creator, which runs before hydration starts.
	let markHydrated: () => void = () => {};
	let failHydration: (error: unknown) => void = () => {};
	let setPersistError: (error: PersistError | null) => void = () => {};
	/** A read failure reported while hydrating synchronously, before the state exists. */
	let earlyPersistError: PersistError | null = null;
	/** Keys hydration could not read (reported by the storage before `merge` runs). */
	let hydrationGaps: HydrationGaps | null = null;
	let mergeExternal: (changes: ExternalChanges, opts?: { markAdopted?: boolean }) => void =
		() => {};
	let announce: (keys: string[]) => void = () => {};
	/** Merges what other tabs announced while this one was hydrating (set up below). */
	let drainEarly: () => void = () => {};

	/**
	 * Versions this tab replaced with a version the sync order ranks lower
	 * (pendingKey → versions): `restampFuture` lowering an unpushable future
	 * stamp, or a server copy adopted on an equal stamp (`remoteReplaces`).
	 * Every other tab still holding one would keep it in a merge (it is
	 * "newer") and write it back, and this tab would adopt it again: the
	 * record would never converge. So they are sent with every cross-tab
	 * announcement; a tab never adopts a retired version, and replaces its
	 * own retired copy with the one on disk. An entry is dropped once the
	 * record's current version outranks it.
	 */
	const retired = new Map<string, unknown[]>();
	const isRetired = (key: string, version: unknown): boolean =>
		retired.get(key)?.some((old) => compareVersions(old, version) === 0) ?? false;
	const retire = (key: string, version: unknown) => {
		if (version === undefined || isRetired(key, version)) return;
		const list = retired.get(key);
		if (list) list.push(version);
		else retired.set(key, [version]);
		if (retired.size > MAX_RETIRED) {
			const oldest = retired.keys().next().value;
			if (oldest !== undefined) retired.delete(oldest);
		}
	};

	/**
	 * Pending keys dropped while tracking (pushed, settled by a server copy, or
	 * refused for good), by this tab or another, with the version of the record
	 * then (`versionId`). Pending keys are unioned across tabs, so a tab still
	 * listing one would hand it back through the meta key: two tabs would
	 * re-push it, and sync again, for good. A tab drops a key another tab
	 * settled at the version it holds, and never takes back a key whose record
	 * is still a settled version. An edit makes a new version, so its key is
	 * taken as usual.
	 */
	const settled = new Map<string, string>();
	const isSettled = (key: string, record: unknown): boolean => {
		const id = settled.get(key);
		if (id === undefined) return false;
		if (id === versionId(collectionOfKey(key), record)) return true;
		settled.delete(key);
		return false;
	};
	const settle = (key: string, id: string) => {
		settled.delete(key);
		settled.set(key, id);
		if (settled.size > MAX_SETTLED) {
			const oldest = settled.keys().next().value;
			if (oldest !== undefined) settled.delete(oldest);
		}
	};

	const storage = createSplitStorage(kv, name, {
		debounceMs: options.debounceMs,
		version: STORE_VERSION,
		onError: (error) => {
			const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
			console.warn("[atomic] Could not save on this device", error);
			setPersistError({ at: now(), message });
			notify({ type: "persist-error", message });
		},
		onSaved: (keys) => {
			setPersistError(null);
			if (keys.length) announce(keys);
		},
		// Records found in a slice nobody had read (a lost slice listing): their
		// pending keys were lost with it, so they are marked again while tracking.
		onDiscovered: (changes) => mergeExternal(changes, { markAdopted: true }),
		onIncomplete: (gaps) => {
			hydrationGaps = gaps;
		},
	});

	const store = createStore<AtomicState>()(
		persist(
			(set, get) => {
				markHydrated = () => {
					// First: their re-reads queue ahead of this tab's first write.
					drainEarly();
					set({ hydrated: true });
					// App start (spec §3.1): recent entry-driven days follow their entries
					// again (catches v1 clients toggling tracker habits). A no-op while
					// `partial` (the logs it compares against may be the missing ones).
					try {
						get().actions.reconcileTrackers({ window: reconcileWindow(toDayKey(now())) });
					} catch (error) {
						console.warn("[atomic] Start-up tracker reconciliation failed", error);
					}
				};
				/**
				 * Hydration threw (zustand calls back with the error and keeps the
				 * initial, empty state). Nothing may be written: the storage turns
				 * read-only for the session, so the data on disk survives, and the
				 * error is shown (blocking banner). The app still starts.
				 */
				failHydration = (error) => {
					storage.lock();
					console.error("[atomic] Could not load stored data; changes stay in memory", error);
					const message =
						error instanceof Error ? `${error.name}: ${error.message}` : String(error);
					const persistError = { at: now(), message };
					// A synchronous hydration fails while zustand is still creating the
					// store, which then installs the initial state: update it afterwards.
					void Promise.resolve().then(() => {
						set({ persistError, partial: true });
						notify({ type: "persist-error", message });
						markHydrated();
					});
				};
				setPersistError = (error) => {
					// During synchronous hydration zustand has no state yet: keep it for `merge`.
					if (!get()) earlyPersistError = error;
					else if (error || get().persistError) set({ persistError: error });
				};

				/**
				 * Records and pending keys another tab wrote (or a stale v1 tab, via
				 * the legacy key): newer records in the sync order win
				 * (`compareVersions`; an equal stamp is broken by content, so two
				 * tabs never keep different copies and rewrite each other's), pending
				 * keys are unioned, and the other tab's settings are adopted. Settings
				 * keys the writer left out (a v1 build strips the ones it doesn't
				 * know) keep this tab's values.
				 *
				 * `markAdopted`: the writing tab wasn't tracking (D57; it was opened
				 * before the sign-in in this tab), so its edits carry no pending keys.
				 * While this tab tracks, every record it adopts is marked pending, or
				 * no tab would ever push it. Re-pushing a synced record is harmless
				 * (last-write-wins).
				 *
				 * Retired versions (see `retired`) are never adopted, and a retired
				 * copy of this tab's gives way to whatever is on disk. A recovery in
				 * progress (`SyncMeta.recovering`) is unioned: this tab is then
				 * `partial` too, until its own re-pull completed.
				 */
				mergeExternal = (changes, opts = {}) => {
					set((state) => {
						const mark = opts.markAdopted === true && state.sync.tracking;
						let data: AtomicData | null = null;
						let pending: Record<string, true> | null = null;
						for (const collection of COLLECTIONS) {
							const incoming = changes.data[collection];
							if (!incoming) continue;
							const current = state.data[collection] as Record<string, unknown>;
							let records: Record<string, unknown> | null = null;
							for (const id in incoming) {
								const record = incoming[id];
								if (typeof record !== "object" || record === null) continue;
								const key = pendingKey(collection, id);
								if (retired.size && isRetired(key, record)) continue;
								const mine = current[id];
								// The sync order: an equal stamp is broken by content, the same way in every tab.
								const stale = mine !== undefined && retired.size > 0 && isRetired(key, mine);
								if (mine !== undefined && !stale && compareVersions(record, mine) <= 0) continue;
								records ??= { ...current };
								records[id] = record;
								if (
									mark &&
									!state.sync.pending[key] &&
									state.sync.superseded[key] === undefined &&
									!(settled.size && isSettled(key, record))
								) {
									pending ??= { ...state.sync.pending };
									pending[key] = true;
								}
							}
							if (records) {
								data ??= { ...state.data };
								(data as Record<Collection, unknown>)[collection] = records;
							}
						}
						for (const key in changes.pending) {
							if (state.sync.pending[key] || pending?.[key]) continue;
							// Settled by a tab (maybe this one) at the version held here: a stale listing.
							if (settled.size && isSettled(key, recordAt(data ?? state.data, key))) continue;
							pending ??= { ...state.sync.pending };
							pending[key] = true;
						}
						let settings = state.settings;
						if (changes.settings !== undefined) {
							const parsed = settingsSchema.safeParse({
								...DEFAULT_SETTINGS,
								...settings,
								...(typeof changes.settings === "object" ? changes.settings : {}),
							});
							if (parsed.success && JSON.stringify(parsed.data) !== JSON.stringify(settings)) {
								settings = parsed.data;
							}
						}
						let foreign = state.foreign;
						for (const [collection, records] of Object.entries(changes.foreign)) {
							const current = foreign[collection] ?? {};
							let next: Record<string, unknown> | null = null;
							for (const id in records) {
								if (current[id] !== undefined && compareVersions(records[id], current[id]) <= 0) {
									continue;
								}
								next ??= { ...current };
								next[id] = records[id];
							}
							if (next) foreign = { ...foreign, [collection]: next };
						}
						const mine = state.sync.recovering ?? null;
						const recovering = changes.recovering ? unionRecovery(mine, changes.recovering) : mine;
						const joined =
							recovering !== mine &&
							(recovering?.keys.length !== mine?.keys.length ||
								Object.keys(recovering?.provisional ?? {}).length !==
									Object.keys(mine?.provisional ?? {}).length);
						if (
							!data &&
							!pending &&
							!joined &&
							settings === state.settings &&
							foreign === state.foreign
						) {
							return state;
						}
						let sync = pending ? { ...state.sync, pending } : state.sync;
						if (joined && recovering) {
							// Recovered by this tab's own re-pull, like at hydration.
							sync = { ...sync, recovering, schemaRev: Math.min(sync.schemaRev, 1) };
						}
						return {
							data: data ? deriveAutoEmojis(data) : state.data,
							settings,
							sync,
							foreign,
							...(joined ? { partial: true } : {}),
						};
					});
				};

				/** Write entities and mark them for sync. */
				/**
				 * `updatedAt` for a write: the corrected clock, and strictly newer than
				 * the version being replaced, so a local edit always wins last-write-wins
				 * against its own previous version (even with a skewed or repeated
				 * clock, D45).
				 */
				const stamp = (prev?: { updatedAt: number }) => {
					const t = now() + (get()?.sync.clockOffsetMs || 0);
					return prev ? Math.max(t, prev.updatedAt + 1) : t;
				};

				/**
				 * Schema-checks an entity before it is stored. Unknown fields (written
				 * by newer clients) are kept; invalid writes are dropped with a warning
				 * so nothing unsyncable or unexportable ever reaches the store.
				 */
				const validated = <C extends Collection>(
					collection: C,
					candidate: unknown,
				): EntityByCollection[C] | null => {
					const parsed = collectionSchemas[collection].safeParse(candidate);
					if (parsed.success) {
						return {
							...(candidate as Record<string, unknown>),
							...(parsed.data as Record<string, unknown>),
						} as EntityByCollection[C];
					}
					console.warn(`[atomic] Ignored invalid ${collection} write`, parsed.error.issues);
					return null;
				};

				/** Superseded keys among `changes` (documents a newer build wrote, spec §2.7). */
				const supersededIn = (changes: CommitChanges): string[] => {
					const superseded = get().sync.superseded;
					const keys: string[] = [];
					if (isEmpty(superseded)) return keys;
					for (const collection of COLLECTIONS) {
						for (const entity of changes[collection] ?? []) {
							const key = pendingKey(collection, entity.id);
							if (superseded[key] !== undefined) keys.push(key);
						}
					}
					return keys;
				};

				/** Writes entities in one `set()` and announces the commit (spec §3.1). */
				const commit = (changes: CommitChanges, opts: { origin?: CommitOrigin } = {}) => {
					const origin = opts.origin ?? "local";
					let accepted = changes;
					if (origin !== "remote") {
						const blocked = supersededIn(changes);
						if (blocked.length) {
							if (origin === "local") {
								notify({ type: "superseded", key: blocked[0] as string });
								return;
							}
							const skip = new Set(blocked);
							const filtered: CommitChanges = {};
							for (const collection of COLLECTIONS) {
								const list = changes[collection];
								if (!list) continue;
								(filtered as Record<Collection, unknown[]>)[collection] = list.filter(
									(entity) => !skip.has(pendingKey(collection, entity.id)),
								);
							}
							accepted = filtered;
						}
					}
					let wrote = false;
					/** Versions this commit replaced with lower ones (`restampFuture`). */
					const lowered: [string, unknown][] = [];
					set((state) => {
						const track = origin !== "remote" && state.sync.tracking;
						let data: AtomicData | null = null;
						let pending: Record<string, true> | null = null;
						const recovering = track ? state.sync.recovering : undefined;
						let provisional: Record<string, true> | null = null;
						for (const collection of COLLECTIONS) {
							const list = accepted[collection];
							if (!list?.length) continue;
							data ??= { ...state.data };
							const before = state.data[collection] as Record<string, unknown>;
							const records = { ...before } as Record<string, unknown>;
							for (const entity of list) {
								const key = pendingKey(collection, entity.id);
								const previous = before[entity.id];
								if (previous !== undefined && compareVersions(entity, previous) < 0) {
									lowered.push([key, previous]);
								}
								// Created over a record this device couldn't read (it lived in a
								// corrupt key): rebased onto the server's copy when it arrives.
								if (
									recovering &&
									previous === undefined &&
									recovering.provisional[key] === undefined &&
									recovering.keys.includes(layoutKeyOf(name, collection, entity))
								) {
									provisional ??= { ...recovering.provisional };
									provisional[key] = true;
								}
								records[entity.id] = entity;
								if (track) {
									pending ??= { ...state.sync.pending };
									pending[key] = true;
								}
							}
							(data as Record<Collection, unknown>)[collection] = records;
						}
						if (!data) return state;
						wrote = true;
						let sync = pending ? { ...state.sync, pending } : state.sync;
						if (recovering && provisional)
							sync = { ...sync, recovering: { ...recovering, provisional } };
						return { data, sync };
					});
					for (const [key, version] of lowered) retire(key, version);
					if (wrote) emitCommit({ origin, changes: accepted });
				};

				const put = <C extends Collection>(collection: C, ...entities: EntityByCollection[C][]) => {
					if (entities.length) commit({ [collection]: entities } as CommitChanges);
				};

				const internals: StoreInternals = {
					get,
					now,
					today: () => toDayKey(now()),
					settings: () => get().settings,
					translator: () => {
						const locale = resolveLocale(get().settings.locale, deviceLocales());
						let translator = translators.get(locale);
						if (!translator) {
							translator = createTranslator(locale);
							translators.set(locale, translator);
						}
						return translator;
					},
					stamp,
					validated,
					commit,
					notify,
				};

				const patch = <C extends Collection>(
					collection: C,
					id: string,
					changes: Partial<EntityByCollection[C]>,
				) => {
					const current = get().data[collection][id] as EntityByCollection[C] | undefined;
					if (!current) return;
					const next = validated(collection, {
						...current,
						...changes,
						id,
						updatedAt: stamp(current),
					});
					if (next) put(collection, next);
				};

				const writeLog = (habitId: string, date: DayKey, changes: Partial<HabitLog>) => {
					const id = logId(habitId, date);
					const current = get().data.logs[id];
					const t = stamp();
					// A tombstone (a replace import, or one synced from another device) reads as
					// "no log" everywhere: a write starts that day afresh, never from its old
					// count, skip or note. Its id, createdAt and unknown fields stay.
					const base: HabitLog = current?.deletedAt
						? { ...current, count: 0, skipped: false, note: null }
						: (current ?? {
								id,
								habitId,
								date,
								count: 0,
								skipped: false,
								note: null,
								createdAt: t,
								updatedAt: t,
								deletedAt: null,
							});
					const next = validated("logs", {
						...base,
						...changes,
						id,
						habitId,
						date,
						deletedAt: null,
						updatedAt: stamp(current),
					});
					if (next) put("logs", next);
				};

				/** A day's logged count as every screen reads it: a tombstoned log counts 0. */
				const liveCount = (habitId: string, date: DayKey): number => {
					const log = get().data.logs[logId(habitId, date)];
					return log && !log.deletedAt ? log.count : 0;
				};

				type Doc = { id: string; updatedAt: number; deletedAt: number | null };

				/**
				 * Replaces the given collections with `next`: live entities that
				 * disappear become tombstones (so the deletion syncs), existing
				 * tombstones stay, and every written entity is re-stamped as a fresh
				 * local write (pending while tracking). Superseded keys are left as
				 * they are. Other collections are untouched.
				 */
				const replaceData = (
					state: AtomicState,
					next: Partial<AtomicData>,
					t: number,
					collections: readonly Collection[],
				) => {
					const data = { ...state.data };
					const track = state.sync.tracking;
					const pending: Record<string, true> = { ...state.sync.pending };
					const { superseded } = state.sync;
					const changes: CommitChanges = {};
					for (const collection of collections) {
						const current = state.data[collection] as Record<string, Doc>;
						const incoming = (next[collection] ?? {}) as Record<string, Doc>;
						const records: Record<string, Doc> = {};
						const written: Doc[] = [];
						const write = (id: string, entity: Doc) => {
							records[id] = entity;
							written.push(entity);
							if (track) pending[pendingKey(collection, id)] = true;
						};
						for (const [id, entity] of Object.entries(current)) {
							if (incoming[id]) continue;
							if (entity.deletedAt || superseded[pendingKey(collection, id)] !== undefined) {
								records[id] = entity;
								continue;
							}
							write(id, { ...entity, deletedAt: t, updatedAt: Math.max(t, entity.updatedAt + 1) });
						}
						for (const [id, entity] of Object.entries(incoming)) {
							const previous = current[id];
							if (superseded[pendingKey(collection, id)] !== undefined) {
								if (previous) records[id] = previous;
								continue;
							}
							const updatedAt = Math.max(
								t,
								entity.updatedAt + 1,
								previous ? previous.updatedAt + 1 : Number.NEGATIVE_INFINITY,
							);
							write(id, { ...entity, updatedAt });
						}
						(data as Record<Collection, unknown>)[collection] = records;
						(changes as Record<Collection, unknown>)[collection] = written;
					}
					return { data, pending: track ? pending : state.sync.pending, changes };
				};

				/** `upgradeRecord`, then the schema; `{...upgraded, ...parsed}` or null (spec §2.8). */
				const importedRecord = <C extends Collection>(
					collection: C,
					raw: unknown,
				): EntityByCollection[C] | null => {
					if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
					const upgraded = upgradeRecord(collection, raw as Record<string, unknown>);
					const parsed = collectionSchemas[collection].safeParse(upgraded);
					if (!parsed.success) return null;
					return {
						...upgraded,
						...(parsed.data as Record<string, unknown>),
					} as EntityByCollection[C];
				};

				/** The app language: stamped as `lang` on what the user types (D44). */
				const locale = () => internals.translator().locale;

				/** The emoji of a live identity, for `emojiAuto` habits. */
				const identityEmoji = (identityId: string | null | undefined): string | null => {
					const identity = identityId ? get().data.identities[identityId] : undefined;
					return identity && !identity.deletedAt ? identity.emoji : null;
				};

				/** Live task logs of a task (shared index, date ascending). */
				const taskLogsOf = (taskId: string): readonly TaskLog[] =>
					taskLogIndexOf(get().data.taskLogs).get(taskId) ?? [];

				/** `updateHabit`; `verbatimTracker` skips the tracker rules (`restoreTrackerSetup`). */
				const writeHabit = (id: string, changes: HabitPatch, verbatimTracker = false) => {
					const current = get().data.habits[id];
					if (!current) return;
					const sanitized = sanitizeHabit(changes);
					const today = toDayKey(now());
					// An input tracker config is parsed by `normalizeTrackerChange` / the schema below.
					let candidate = {
						...current,
						...sanitized,
						goalHistory: current.goalHistory ?? [],
						updatedAt: stamp(current),
					} as Habit;
					// Tracker changes (and kind changes, which can drop a tracker) follow Annex K §1.5;
					// an undo puts back the setup it saved as it was.
					if (
						!verbatimTracker &&
						("tracker" in sanitized || ("kind" in sanitized && candidate.tracker != null))
					) {
						candidate = normalizeTrackerChange(current, candidate, {
							today,
							t: internals.translator(),
						});
					}
					// Past days keep the goal they were logged against (Annex H §2.3).
					if (!sameGoal(current, candidate) && today > current.startDate) {
						candidate.goalHistory = nextGoalHistory(current, candidate, today);
					}
					if (
						candidate.emojiAuto === true &&
						(sanitized.emojiAuto === true || "identityId" in sanitized || "kind" in sanitized)
					) {
						candidate.emoji = autoHabitEmoji(candidate.kind, identityEmoji(candidate.identityId));
					}
					if (current.lang == null && HABIT_TEXT_FIELDS.some((key) => key in sanitized)) {
						candidate.lang = locale();
					}
					const next = habitSchema.safeParse(candidate);
					if (!next.success) {
						console.warn("[atomic] Ignored invalid habit update", next.error.issues);
						return;
					}
					const habit = { ...candidate, ...next.data } as Habit;
					// A tracker attached, switched, re-enabled or detached: its entry days
					// from the (new) start follow their entries, in the same commit.
					let logs: HabitLog[] = [];
					if (trackerShape(current) !== trackerShape(habit)) {
						const { data } = get();
						const view = { ...data, habits: { ...data.habits, [id]: habit } };
						const pairs = pairsForHabit(view, id, trackerEntryIndexOf(data.trackerEntries));
						const { superseded } = get().sync;
						logs = plannedLogs(view, reconcilePlan(view, pairs, { superseded }), stamp);
					}
					commit({ habits: [habit], logs });
				};

				const storeActions: StoreActions = {
					createHabit(input) {
						const t = stamp();
						const today = toDayKey(now());
						let habit: Habit = habitSchema.parse({
							startDate: today,
							order: nextOrder(get().data.habits),
							...sanitizeHabit(input),
							goalHistory: [],
							lang: input.lang ?? locale(),
							id: createId(),
							createdAt: t,
							updatedAt: t,
							deletedAt: null,
						});
						if (habit.emojiAuto) {
							habit = {
								...habit,
								emoji: autoHabitEmoji(habit.kind, identityEmoji(habit.identityId)),
							};
						}
						if (habit.tracker != null) {
							habit = habitSchema.parse(
								normalizeTrackerChange(null, habit, { today, t: internals.translator() }),
							);
						}
						put("habits", habit);
						return habit;
					},
					updateHabit(id, changes) {
						writeHabit(id, changes);
					},
					restoreTrackerSetup(id, before) {
						writeHabit(
							id,
							{ tracker: before.tracker ?? null, target: before.target, unit: before.unit },
							true,
						);
					},
					archiveHabit(id, archived = true) {
						patch("habits", id, { archivedAt: archived ? now() : null });
					},
					deleteHabit(id) {
						// Spec §2.5: one commit, one timestamp for the habit, its tasks, its
						// tracker entries and the open tasks those entries created.
						const { data } = get();
						const current = data.habits[id];
						if (!current || current.deletedAt) return;
						const t = now();
						const tombstone = <C extends "habits" | "tasks" | "trackerEntries">(
							collection: C,
							entity: EntityByCollection[C],
						) => validated(collection, { ...entity, deletedAt: t, updatedAt: stamp(entity) });
						const habit = tombstone("habits", current);
						if (!habit) return;
						const entries = Object.values(data.trackerEntries)
							.filter((entry) => entry.habitId === id && !entry.deletedAt)
							.map((entry) => tombstone("trackerEntries", entry))
							.filter((entry) => entry !== null);
						const entryIds = new Set(entries.map((entry) => entry.id));
						const tasks = Object.values(data.tasks)
							.filter(
								(task) =>
									!task.deletedAt &&
									(task.habitId === id ||
										(task.completedAt == null &&
											task.sourceEntryId != null &&
											entryIds.has(task.sourceEntryId))),
							)
							.map((task) => tombstone("tasks", task))
							.filter((task) => task !== null);
						commit({ habits: [habit], tasks, trackerEntries: entries });
					},
					restoreHabit(id) {
						// Restores exactly what the delete cascaded (equal `deletedAt`); things
						// deleted earlier stay deleted.
						const { data } = get();
						const current = data.habits[id];
						if (!current?.deletedAt) return;
						const t = current.deletedAt;
						const revive = <C extends "habits" | "tasks" | "trackerEntries">(
							collection: C,
							entity: EntityByCollection[C],
						) => validated(collection, { ...entity, deletedAt: null, updatedAt: stamp(entity) });
						const habit = revive("habits", current);
						if (!habit) return;
						const entries = Object.values(data.trackerEntries)
							.filter((entry) => entry.habitId === id && entry.deletedAt === t)
							.map((entry) => revive("trackerEntries", entry))
							.filter((entry) => entry !== null);
						const entryIds = new Set(entries.map((entry) => entry.id));
						const tasks = Object.values(data.tasks)
							.filter(
								(task) =>
									task.deletedAt === t &&
									(task.habitId === id ||
										(task.sourceEntryId != null && entryIds.has(task.sourceEntryId))),
							)
							.map((task) => revive("tasks", task))
							.filter((task) => task !== null);
						commit({ habits: [habit], tasks, trackerEntries: entries });
					},
					reorderHabits(ids) {
						const habits = get().data.habits;
						const changed: Habit[] = [];
						ids.forEach((id, order) => {
							const habit = habits[id];
							if (habit && habit.order !== order) {
								changed.push({ ...habit, order, updatedAt: stamp(habit) });
							}
						});
						put("habits", ...changed);
					},

					setCount(habitId, date, count) {
						const habit = get().data.habits[habitId];
						if (!habit || !Number.isFinite(count)) return;
						if (isTrackerDay(habit, date) || foreignTrackerDay(habit, date)) {
							// Tracker days count their entries (Annex K §1.3); increment and toggle land here too.
							console.warn(`[atomic] ${habitId} on ${date} is logged through its tracker`);
							return;
						}
						const value = Math.max(0, Math.min(100_000, Math.round(count)));
						writeLog(
							habitId,
							date,
							value > 0 ? { count: value, skipped: false } : { count: value },
						);
					},
					increment(habitId, date, delta = 1) {
						actions.setCount(habitId, date, liveCount(habitId, date) + delta);
					},
					toggleHabit(habitId, date) {
						const habit = get().data.habits[habitId];
						if (!habit) return;
						const current = liveCount(habitId, date);
						if (habit.kind === "break") {
							actions.setCount(habitId, date, current > 0 ? 0 : 1);
						} else {
							// That day's goal (Annex H §2.3): a past day keeps the goal it had.
							const target = targetOn(habit, date);
							actions.setCount(habitId, date, current >= target ? 0 : target);
						}
					},
					setSkipped(habitId, date, skipped) {
						const habit = get().data.habits[habitId];
						if (!habit) return;
						if (foreignTrackerDay(habit, date)) {
							console.warn(`[atomic] ${habitId} is logged by a newer version of Atomic`);
							return;
						}
						const tracker = skipped ? knownTracker(habit) : null;
						if (tracker) {
							const types: readonly string[] = [...TRACKER_META[tracker.type].counted, "none"];
							const day = trackerEntryIndexOf(get().data.trackerEntries)
								.byHabitDay.get(habitId)
								?.get(date);
							if (day?.some((entry) => types.includes(entry.type))) {
								console.warn(`[atomic] ${habitId} on ${date} has entries; it can't be skipped`);
								return;
							}
						}
						writeLog(habitId, date, skipped ? { skipped, count: 0 } : { skipped });
					},
					setNote(habitId, date, note) {
						if (!get().data.habits[habitId]) return;
						writeLog(habitId, date, { note: clean(note) });
					},

					createIdentity(input) {
						const t = stamp();
						const identity = identitySchema.parse({
							order: nextOrder(get().data.identities),
							...input,
							lang: input.lang ?? locale(),
							statement: input.statement.trim(),
							id: createId(),
							createdAt: t,
							updatedAt: t,
							deletedAt: null,
						});
						put("identities", identity);
						return identity;
					},
					updateIdentity(id, changes) {
						const next = { ...changes };
						if (typeof next.statement === "string") next.statement = next.statement.trim();
						if (next.statement === "") return;
						const { data } = get();
						const current = data.identities[id];
						if (!current) return;
						if (current.lang == null && "statement" in next) next.lang = locale();
						const identity = validated("identities", {
							...current,
							...next,
							id,
							updatedAt: stamp(current),
						});
						if (!identity) return;
						// Spec §2.5: auto icons follow the identity (stamped, so v1 clients see it too).
						const habits: Habit[] = [];
						if (identity.emoji !== current.emoji && !identity.deletedAt) {
							for (const habit of Object.values(data.habits)) {
								if (habit.deletedAt || habit.identityId !== id || habit.emojiAuto !== true)
									continue;
								const emoji = autoHabitEmoji(habit.kind, identity.emoji);
								if (habit.emoji !== emoji)
									habits.push({ ...habit, emoji, updatedAt: stamp(habit) });
							}
						}
						commit({ identities: [identity], habits });
					},
					deleteIdentity(id) {
						const { data } = get();
						// Unlinked auto icons fall back to the kind default (spec §2.5).
						const habits = Object.values(data.habits)
							.filter((h) => h.identityId === id)
							.map((h) => ({
								...h,
								identityId: null,
								...(h.emojiAuto === true ? { emoji: DEFAULT_HABIT_EMOJI[h.kind] } : {}),
								updatedAt: stamp(h),
							}));
						const tasks = Object.values(data.tasks)
							.filter((task) => task.identityId === id)
							.map((task) => ({ ...task, identityId: null, updatedAt: stamp(task) }));
						const current = data.identities[id];
						const identity = current
							? validated("identities", { ...current, deletedAt: now(), updatedAt: stamp(current) })
							: null;
						// One commit: a superseded record refuses the whole action.
						commit({ habits, tasks, identities: identity ? [identity] : [] });
					},

					createTask(input) {
						const t = stamp();
						const extra: Partial<Task> = {};
						if (input.repeat != null) {
							// A series needs a start (its phase anchor); weekly rules freeze the week start.
							const date = input.date ?? toDayKey(now());
							extra.date = date;
							if (isKnownRule(input.repeat)) {
								extra.repeat =
									sanitizeRepeat(input.repeat, {
										anchor: date,
										weekStartsOn: get().settings.weekStartsOn,
									}) ?? input.repeat;
							}
						}
						const task = taskSchema.parse({
							order: nextOrder(get().data.tasks),
							...input,
							...extra,
							title: input.title.trim(),
							notes: clean(input.notes),
							lang: input.lang ?? locale(),
							id: createId(),
							createdAt: t,
							updatedAt: t,
							deletedAt: null,
						});
						put("tasks", task);
						return task;
					},
					updateTask(id, changes) {
						const current = get().data.tasks[id];
						if (!current) return;
						let next: TaskPatch = { ...changes };
						if (typeof next.title === "string") next.title = next.title.trim();
						if (next.title === "") return;
						if ("notes" in next) next.notes = clean(next.notes);
						if (current.lang == null && "title" in next) next.lang = locale();
						const today = toDayKey(now());
						const wasSeries = current.repeat != null;
						const repeats = "repeat" in next ? next.repeat != null : wasSeries;
						// A series keeps its start date (its phase anchor).
						if (repeats && "date" in next && next.date == null) {
							const { date: _ignored, ...rest } = next;
							next = rest;
						}
						let log: TaskLog | null = null;
						if ("repeat" in next && next.repeat != null) {
							const anchor = next.date ?? current.date ?? today;
							let rule = next.repeat as Record<string, unknown>;
							// An ended series stays ended when only its rule is edited.
							const endedAt = (current.repeat as { endedAt?: unknown } | null)?.endedAt;
							if (wasSeries && !("endedAt" in rule) && endedAt != null) rule = { ...rule, endedAt };
							if (isKnownRule(rule as Task["repeat"])) {
								const sanitized = sanitizeRepeat(rule, {
									anchor,
									weekStartsOn: get().settings.weekStartsOn,
								});
								if (!sanitized) {
									console.warn("[atomic] Ignored invalid repeat rule", rule);
									return;
								}
								next.repeat = sanitized;
							}
							if (!wasSeries) {
								// R11: one-off → series. "Done" survives as a log for the anchor.
								next.date = anchor;
								if (current.completedAt != null) {
									const logId = taskLogId(id, anchor);
									const prev = get().data.taskLogs[logId];
									const lt = stamp();
									log = validated("taskLogs", {
										createdAt: lt,
										...prev,
										id: logId,
										taskId: id,
										date: anchor,
										status: "done",
										resolvedOn: toDayKey(current.completedAt),
										deletedAt: null,
										updatedAt: stamp(prev),
									});
									next.completedAt = null;
								}
							}
						} else if ("repeat" in next && wasSeries) {
							// R12: series → one-off on its open occurrence (logs are kept).
							const state = seriesState(current, taskLogsOf(id), today);
							next.date = state.open ?? anchorOf(current);
						}
						const task = validated("tasks", {
							...current,
							...next,
							id,
							updatedAt: stamp(current),
						});
						if (task) commit({ tasks: [task], taskLogs: log ? [log] : [] });
					},
					toggleTask(id) {
						const task = get().data.tasks[id];
						if (!task) return;
						if (task.repeat != null) {
							// R14: a series is settled per occurrence (completeOccurrence…).
							console.warn(`[atomic] toggleTask ignored for series ${id}`);
							return;
						}
						patch("tasks", id, { completedAt: task.completedAt ? null : now() });
					},
					deleteTask(id) {
						patch("tasks", id, { deletedAt: now() });
					},
					restoreTask(id) {
						patch("tasks", id, { deletedAt: null });
					},
					clearCompletedTasks() {
						const t = now();
						const today = toDayKey(t);
						const { data } = get();
						const done = Object.values(data.tasks)
							.filter((task) => {
								if (task.deletedAt) return false;
								if (task.repeat == null) return task.completedAt != null;
								// A v1 check-off becomes an occurrence (reconcileLegacySeries), not an ending.
								if (isLegacyCheckoff(task)) return false;
								if (task.completedAt != null) return true;
								const habit = task.habitId ? data.habits[task.habitId] : undefined;
								const status = seriesState(task, taskLogsOf(task.id), today, habit).status;
								return status === "ended" || status === "finished";
							})
							.map((task) => ({ ...task, deletedAt: t, updatedAt: stamp(task) }));
						put("tasks", ...done);
					},

					createScorecardItem(input) {
						const t = stamp();
						const item = scorecardItemSchema.parse({
							order: nextOrder(get().data.scorecard),
							...input,
							lang: input.lang ?? locale(),
							label: input.label.trim(),
							id: createId(),
							createdAt: t,
							updatedAt: t,
							deletedAt: null,
						});
						put("scorecard", item);
						return item;
					},
					updateScorecardItem(id, changes) {
						const next = { ...changes };
						if (typeof next.label === "string") next.label = next.label.trim();
						if (next.label === "") return;
						if (get().data.scorecard[id]?.lang == null && "label" in next) next.lang = locale();
						patch("scorecard", id, next);
					},
					deleteScorecardItem(id) {
						patch("scorecard", id, { deletedAt: now() });
					},
					reorderScorecard(ids) {
						const items = get().data.scorecard;
						const changed: ScorecardItem[] = [];
						ids.forEach((id, order) => {
							const item = items[id];
							if (item && item.order !== order) {
								changed.push({ ...item, order, updatedAt: stamp(item) });
							}
						});
						put("scorecard", ...changed);
					},

					updateSettings(changes) {
						const next = settingsSchema.safeParse({ ...get().settings, ...changes });
						if (next.success) set({ settings: next.data });
						else console.warn("[atomic] Ignored invalid settings", next.error.issues);
					},
					exportData() {
						const { data, settings } = get();
						return {
							format: EXPORT_FORMAT,
							version: EXPORT_VERSION,
							exportedAt: now(),
							settings: {
								displayName: settings.displayName,
								weekStartsOn: settings.weekStartsOn,
								locale: settings.locale,
								theme: settings.theme,
							},
							data: {
								habits: Object.values(data.habits),
								logs: Object.values(data.logs),
								tasks: Object.values(data.tasks),
								identities: Object.values(data.identities),
								scorecard: Object.values(data.scorecard),
								taskLogs: Object.values(data.taskLogs),
								journal: Object.values(data.journal),
								trackerEntries: Object.values(data.trackerEntries),
								translations: Object.values(data.translations),
							},
						};
					},
					importData(file, mode = "merge") {
						const parsed = exportFileSchema.safeParse(file);
						if (!parsed.success) {
							return { ok: false, imported: 0, skipped: 0, error: "invalid-file" };
						}
						const incoming = parsed.data;
						// Only the collections the file's version can contain (spec §2.8).
						const scope = EXPORT_COLLECTIONS[incoming.version];
						const { superseded } = get().sync;
						let imported = 0;
						let skipped = 0;
						const valid: Partial<Record<Collection, Record<string, Doc>>> = {};
						for (const collection of scope) {
							const records: Record<string, Doc> = {};
							for (const raw of incoming.data[collection]) {
								const record = importedRecord(collection, raw) as Doc | null;
								if (!record || superseded[pendingKey(collection, record.id)] !== undefined) {
									skipped++;
									continue;
								}
								if (shouldReplace(records[record.id], record)) records[record.id] = record;
							}
							valid[collection] = records;
						}
						let changes: CommitChanges = {};
						set((state) => {
							let data: AtomicData;
							let pending = state.sync.pending;
							if (mode === "replace") {
								// Restoring a backup: its contents win in its collections, and
								// whatever is not in it is deleted there (as tombstones, so other
								// devices follow).
								const replaced = replaceData(state, valid as Partial<AtomicData>, stamp(), scope);
								({ data, pending, changes } = replaced);
								for (const collection of scope)
									imported += Object.keys(valid[collection] ?? {}).length;
							} else {
								data = { ...state.data };
								const track = state.sync.tracking;
								if (track) pending = { ...pending };
								for (const collection of scope) {
									const current = state.data[collection] as Record<string, Doc>;
									let records: Record<string, Doc> | null = null;
									const written: Doc[] = [];
									for (const [id, record] of Object.entries(valid[collection] ?? {})) {
										if (!shouldReplace(current[id], record)) continue;
										records ??= { ...current };
										records[id] = record;
										written.push(record);
										if (track) pending[pendingKey(collection, id)] = true;
										imported++;
									}
									if (records) (data as Record<Collection, unknown>)[collection] = records;
									(changes as Record<Collection, unknown>)[collection] = written;
								}
							}
							// A backup's profile and appearance settings come back with it.
							const settings = settingsSchema.parse({
								...state.settings,
								...incoming.settings,
								onboarded: true,
							});
							return {
								data: deriveAutoEmojis(data),
								settings,
								sync: pending === state.sync.pending ? state.sync : { ...state.sync, pending },
							};
						});
						emitCommit({ origin: "derived", changes });
						// Through the state, so a wrapped action (tests, devtools) sees the call.
						get().actions.reconcileTrackers();
						get().actions.reconcileLegacySeries();
						return { ok: true, imported, skipped };
					},
					loadDemoData(locale) {
						const demo = buildDemoData({
							today: toDayKey(now()),
							now: now(),
							locale: locale ?? resolveLocale(get().settings.locale, deviceLocales()),
							weekStartsOn: get().settings.weekStartsOn,
						});
						let changes: CommitChanges = {};
						set((state) => {
							const replaced = replaceData(state, demo, stamp(), COLLECTIONS);
							changes = replaced.changes;
							return {
								data: deriveAutoEmojis(replaced.data),
								settings: { ...state.settings, onboarded: true },
								sync:
									replaced.pending === state.sync.pending
										? state.sync
										: { ...state.sync, pending: replaced.pending },
							};
						});
						emitCommit({ origin: "derived", changes });
					},
					// Both wipe the data on purpose: nothing is missing from it any more.
					resetAll() {
						void storage.purge();
						set({
							data: emptyData(),
							settings: { ...DEFAULT_SETTINGS },
							sync: emptySync(),
							foreign: {},
							partial: false,
						});
						void storage.flush();
					},
					clearLocalData() {
						void storage.purge();
						set((state) => ({
							data: emptyData(),
							sync: {
								...emptySync(),
								tracking: state.sync.tracking,
								clockOffsetMs: state.sync.clockOffsetMs,
							},
							foreign: {},
							partial: false,
						}));
						void storage.flush();
					},

					applyRemote(records, opts = {}) {
						const origin = opts.origin ?? "remote";
						let applied = 0;
						const changes: CommitChanges = {};
						const pairs: HabitDay[] = [];
						const pairKeys = new Set<string>();
						const addPair = (habitId: unknown, date: unknown) => {
							if (typeof habitId !== "string" || typeof date !== "string") return;
							const key = `${habitId}\n${date}`;
							if (pairKeys.has(key)) return;
							pairKeys.add(key);
							pairs.push({ habitId, date });
						};
						const series = new Set<string>();
						const changedTrackers = new Set<string>();
						const derived: CommitChanges = {};
						/** Local versions replaced by a version the sync order ranks lower. */
						const retiredNow: [string, unknown][] = [];
						set((state) => {
							let data: Record<Collection, Record<string, Doc>> | null = null;
							let pending: Record<string, true> | null = null;
							let superseded: Record<string, number> | null = null;
							const unpend = (key: string) => {
								if (!(pending ?? state.sync.pending)[key]) return;
								pending ??= { ...state.sync.pending };
								delete pending[key];
							};
							const recovering = state.sync.recovering;
							let provisional: Record<string, true> | null = null;
							for (const record of records) {
								// Collections from newer clients are skipped, not fatal.
								if (!isKnownCollection(record.collection)) continue;
								const collection = record.collection;
								const key = pendingKey(collection, record.id);
								const current = (data ?? state.data)[collection][record.id] as Doc | undefined;
								const isPending = (pending ?? state.sync.pending)[key] === true;
								// What the server stored and compared: the decision mirrors it exactly.
								const wire: Json = {
									...record.data,
									id: record.id,
									updatedAt: record.updatedAt,
									deletedAt: record.deletedAt,
								};
								// Documents written by older builds are upgraded before validation (§2.3).
								const candidate = upgradeRecord(collection, wire);
								const parsed = collectionSchemas[collection].safeParse(candidate);
								const known = (superseded ?? state.sync.superseded)[key];
								if (!parsed.success) {
									// A newer document this build can't read (a newer schema
									// revision): read-only until the app updates (spec §2.7).
									if (current && !remoteReplaces(collection, current, wire, null, isPending))
										continue;
									if (known !== undefined && known >= record.updatedAt) continue;
									superseded ??= { ...state.sync.superseded };
									superseded[key] = record.updatedAt;
									unpend(key);
									continue;
								}
								if (known !== undefined && record.updatedAt >= known) {
									superseded ??= { ...state.sync.superseded };
									delete superseded[key];
								}
								// Keep fields this client doesn't know so it never erases them.
								let next = { ...candidate, ...(parsed.data as object) } as Doc;
								let keepPending = false;
								if (current && recovering && (provisional ?? recovering.provisional)[key]) {
									// Created here over a base this device couldn't read: the
									// server's copy is that base (spec addition, `SyncRecovery`).
									provisional ??= { ...recovering.provisional };
									delete provisional[key];
									// A newer local edit is rebased onto it. Otherwise the server's
									// copy stays: it is newer, or the local record was deleted, and
									// deleting what was created here says nothing about it.
									if (!current.deletedAt && current.updatedAt > next.updatedAt) {
										const rebased = validated(
											collection,
											rebaseProvisional(next as unknown as Json, current as unknown as Json),
										) as Doc | null;
										if (rebased) {
											next = rebased;
											keepPending = true;
										}
									}
								} else if (
									!remoteReplaces(
										collection,
										current as unknown as Json | undefined,
										wire,
										next as unknown as Json,
										isPending,
									)
								) {
									continue;
								}
								if (current !== undefined && compareVersions(next, current) < 0) {
									retiredNow.push([key, current]);
								}
								if (!data) data = { ...state.data } as Record<Collection, Record<string, Doc>>;
								if (data[collection] === (state.data[collection] as unknown)) {
									data[collection] = { ...data[collection] };
								}
								data[collection][record.id] = next;
								if (!keepPending) unpend(key);
								applied++;
								const written = changes as Record<Collection, Doc[]>;
								if (written[collection]) written[collection].push(next);
								else written[collection] = [next];
								if (collection === "trackerEntries") {
									const before = current as Record<string, unknown> | undefined;
									const after = next as Record<string, unknown>;
									addPair(before?.habitId, before?.date);
									addPair(after.habitId, after.date);
								} else if (collection === "habits") {
									if (trackerShape(current as Habit | undefined) !== trackerShape(next as Habit)) {
										changedTrackers.add(record.id);
									}
								} else if (collection === "tasks" && isLegacyCheckoff(next as Task)) {
									series.add(record.id);
								}
							}
							if (!data && !pending && !superseded && !provisional) return state;
							let nextData = data ? (data as unknown as AtomicData) : state.data;
							if (changedTrackers.size) {
								const index = buildTrackerEntryIndex(nextData.trackerEntries);
								for (const habitId of changedTrackers) {
									for (const pair of pairsForHabit(nextData, habitId, index)) {
										addPair(pair.habitId, pair.date);
									}
								}
							}
							if (opts.reconcile !== false && !state.partial && (pairs.length || series.size)) {
								// Artifact path (spec §3.1): what this call touched is reconciled in
								// the same set(), as derived writes (pending while tracking). Not
								// while `partial`: the logs it would rebuild may be the missing ones.
								const blocked = superseded ?? state.sync.superseded;
								const keep = (collection: Collection) => (entity: { id: string }) =>
									blocked[pendingKey(collection, entity.id)] === undefined;
								const logs = pairs.length
									? plannedLogs(
											nextData,
											reconcilePlan(nextData, pairs, { superseded: blocked }),
											stamp,
										).filter(keep("logs"))
									: [];
								const legacy = series.size
									? legacySeriesWrites(nextData, series, internals)
									: { tasks: [], taskLogs: [] };
								const writes: CommitChanges = {
									logs,
									tasks: legacy.tasks.filter(keep("tasks")),
									taskLogs: legacy.taskLogs.filter(keep("taskLogs")),
								};
								for (const collection of ["logs", "tasks", "taskLogs"] as const) {
									const list = writes[collection] ?? [];
									if (!list.length) continue;
									const records = { ...nextData[collection] } as Record<string, unknown>;
									for (const entity of list) {
										records[entity.id] = entity;
										if (state.sync.tracking) {
											pending ??= { ...state.sync.pending };
											pending[pendingKey(collection, entity.id)] = true;
										}
									}
									nextData = { ...nextData, [collection]: records };
									(derived as Record<Collection, unknown>)[collection] = list;
								}
							}
							let sync = state.sync;
							if (pending || superseded) {
								sync = {
									...sync,
									pending: pending ?? state.sync.pending,
									superseded: superseded ?? state.sync.superseded,
								};
							}
							if (provisional && recovering)
								sync = { ...sync, recovering: { ...recovering, provisional } };
							return {
								data: data || nextData !== state.data ? deriveAutoEmojis(nextData) : state.data,
								sync,
							};
						});
						for (const [key, version] of retiredNow) retire(key, version);
						if (applied) emitCommit({ origin, changes });
						if (!isEmpty(derived)) emitCommit({ origin: "derived", changes: derived });
						return { applied, pairs, series: [...series] };
					},
					setSyncMeta(changes) {
						set((state) => ({ sync: { ...state.sync, ...changes } }));
					},
				};

				const actions: AtomicActions = {
					...storeActions,
					...createHabitV2Actions(internals),
					...createCloudActions(internals),
					...createTaskActions(internals),
					...createJournalActions(internals),
					...createTrackerActions(internals),
				};

				return {
					data: emptyData(),
					settings: { ...DEFAULT_SETTINGS },
					sync: emptySync(),
					foreign: {},
					persistError: null,
					hydrated: false,
					partial: false,
					actions,
				};
			},
			{
				name,
				version: STORE_VERSION,
				storage,
				partialize,
				// Spec §2.6.4: join, normalize on a schema revision change, keep unknown
				// collections, migrate the sync meta, then derive auto icons.
				merge: (persisted, current) => {
					const result = hydratePersisted(persisted);
					logNormalization(result);
					return {
						...current,
						data: deriveAutoEmojis(result.data),
						settings: result.settings,
						sync: result.sync,
						foreign: result.foreign,
						persistError: earlyPersistError ?? current.persistError,
						// A recovery from corrupt keys lasts until its re-pull completed (`watchRecovery`).
						partial: hydrationGaps !== null || result.sync.recovering !== undefined,
					};
				},
				onRehydrateStorage: () => (_state, error) => {
					if (error !== undefined) failHydration(error);
					else markHydrated();
				},
			},
		),
	);

	const persistNow = () =>
		storage.setItem(name, { state: partialize(store.getState()), version: STORE_VERSION });

	/**
	 * A recovery from corrupt keys (`SyncMeta.recovering`: recorded at
	 * hydration, kept across sessions) ends once their records can't come back
	 * any other way: at once when not tracking, else when the requested
	 * re-pull completed (`schemaRev` is current again). The corrupt keys this
	 * session found and nothing replaced are then removed, and the recovery is
	 * cleared. After a re-pull the state is whole: `partial` ends (unless a
	 * read failed this session) and the start-up tracker reconciliation runs.
	 * Until then every session is `partial`, so nothing derived from the
	 * missing records reaches the server.
	 */
	let dropped = false;
	let ending = false;
	const watchRecovery = (state: AtomicState) => {
		// `hydrationGaps` is reported before `merge`, so it is set once hydrated.
		if (ending || !state.hydrated) return;
		const corrupt = (hydrationGaps?.corrupt.length ?? 0) > 0 && !dropped;
		const { recovering, tracking } = state.sync;
		if (!recovering && !corrupt) return;
		if (tracking && state.sync.schemaRev < SCHEMA_REV) return;
		ending = true;
		try {
			if (corrupt) {
				dropped = true;
				void storage.dropCorrupt();
			}
			if (!recovering) return;
			const whole = tracking && hydrationGaps?.unreadable !== true;
			store.setState((s) => {
				const { recovering: _done, ...sync } = s.sync;
				return {
					sync,
					partial: whole ? false : hydrationGaps !== null,
				};
			});
			if (whole) {
				try {
					store.getState().actions.reconcileTrackers({ window: reconcileWindow(toDayKey(now())) });
				} catch (error) {
					console.warn("[atomic] Tracker reconciliation after recovery failed", error);
				}
			}
		} finally {
			ending = false;
		}
	};
	const stopRecoveryWatch = store.subscribe(watchRecovery);
	watchRecovery(store.getState());

	// Cross-tab merging (web): other tabs announce the keys they wrote.
	const opened = openChannel(options.crossTab, name);
	type Announcement = { keys: string[]; markAdopted: boolean; settled: [string, string][] };
	/** Announcements (and legacy writes) received while hydrating: merged right after. */
	const early: Announcement[] = [];
	let legacyEarly = false;

	/** Pending keys this tab settled since its last announcement (see `settled`). */
	const unsent = new Map<string, string>();
	/** Dropping keys another tab settled: not settled here again (no echo). */
	let absorbing = false;
	const stopSettleWatch = opened
		? store.subscribe((state, prev) => {
				if (absorbing || !state.hydrated || state.sync.pending === prev.sync.pending) return;
				if (!state.sync.tracking || !prev.sync.tracking) return;
				for (const key in prev.sync.pending) {
					if (state.sync.pending[key]) continue;
					const record = recordAt(state.data, key);
					// Gone (orphaned, or the data was wiped): nothing for other tabs to drop.
					if (record === undefined) continue;
					const id = versionId(collectionOfKey(key), record);
					settle(key, id);
					unsent.set(key, id);
				}
			})
		: () => {};

	/** Another tab's settled keys become this tab's; returns them. */
	const absorbSettled = (value: unknown): [string, string][] => {
		if (!isJson(value)) return [];
		const out: [string, string][] = [];
		for (const key in value) {
			const id = value[key];
			if (typeof id !== "string") continue;
			settle(key, id);
			out.push([key, id]);
		}
		return out;
	};

	/** Drops the pending keys another tab settled at the version this tab holds. */
	const dropSettled = (entries: readonly [string, string][]) => {
		if (!entries.length) return;
		absorbing = true;
		try {
			store.setState((state) => {
				let pending: Record<string, true> | null = null;
				for (const [key, id] of entries) {
					if (!(pending ?? state.sync.pending)[key]) continue;
					if (versionId(collectionOfKey(key), recordAt(state.data, key)) !== id) continue;
					pending ??= { ...state.sync.pending };
					delete pending[key];
				}
				return pending ? { sync: { ...state.sync, pending } } : state;
			});
		} finally {
			absorbing = false;
		}
	};

	/** Another tab's retired versions become this tab's (see `retired`). */
	const absorbRetired = (value: unknown) => {
		if (!isJson(value)) return;
		for (const key in value) {
			const versions = value[key];
			if (!Array.isArray(versions)) continue;
			for (const version of versions) if (isJson(version)) retire(key, version);
		}
	};

	/** This tab's retired versions that still outrank the record's current version. */
	const liveRetired = (): Record<string, unknown[]> | undefined => {
		if (!retired.size) return undefined;
		const { data } = store.getState();
		const out: Record<string, unknown[]> = {};
		for (const [key, versions] of retired) {
			const parsed = parsePendingKey(key);
			const current = parsed ? data[parsed.collection][parsed.id] : undefined;
			const live =
				current === undefined ? [] : versions.filter((v) => compareVersions(v, current) > 0);
			if (!live.length) retired.delete(key);
			else {
				if (live.length !== versions.length) retired.set(key, live);
				out[key] = live;
			}
		}
		return retired.size ? out : undefined;
	};

	const mergeAnnounced = ({ keys, markAdopted, settled: settledKeys }: Announcement) => {
		void storage
			.readKeys(keys, () => store.getState())
			.then((changes) => {
				if (changes) mergeExternal(changes, { markAdopted });
				// After the merge: the records it brought may be the settled versions.
				dropSettled(settledKeys);
				// Writes what the disk lacks (it may hold an older copy of ours), and
				// nothing else, so the other tab gets no echo.
				return storage.repair({ state: partialize(store.getState()), version: STORE_VERSION });
			})
			.catch((error: unknown) =>
				console.warn("[atomic] Could not merge another tab's changes", error),
			);
	};
	const onMessage = (event: { data: unknown }) => {
		const message = event.data as {
			keys?: unknown;
			tracking?: unknown;
			retired?: unknown;
			settled?: unknown;
		} | null;
		const keys = message?.keys;
		if (!Array.isArray(keys)) return;
		absorbRetired(message?.retired);
		const announcement: Announcement = {
			keys: keys.filter((key): key is string => typeof key === "string"),
			// A writer that wasn't tracking (or didn't say) left its edits unmarked.
			markAdopted: message?.tracking !== true,
			settled: absorbSettled(message?.settled),
		};
		// Hydrating: the disk may have been read before this write landed, and
		// this tab's first write would replace it unmerged (K1). Merged right after.
		if (!store.getState().hydrated) early.push(announcement);
		else mergeAnnounced(announcement);
	};
	// A stale v1 tab writes the legacy localStorage key (IndexedDB fires no events of its own).
	const target = globalThis as {
		addEventListener?: (type: string, listener: (event: { key?: unknown }) => void) => void;
		removeEventListener?: (type: string, listener: (event: { key?: unknown }) => void) => void;
	};
	const mergeLegacy = () => {
		void storage
			.readLegacy()
			.then((changes) => {
				if (!changes) return;
				mergeExternal(changes);
				void persistNow();
			})
			.catch((error: unknown) => console.warn("[atomic] Could not merge legacy data", error));
	};
	const onStorage = (event: { key?: unknown }) => {
		if (event.key !== name) return;
		if (!store.getState().hydrated) legacyEarly = true;
		else mergeLegacy();
	};
	drainEarly = () => {
		const queued = early.splice(0);
		if (queued.length) {
			mergeAnnounced({
				keys: [...new Set(queued.flatMap((a) => a.keys))],
				markAdopted: queued.some((a) => a.markAdopted),
				settled: queued.flatMap((a) => a.settled),
			});
		}
		if (legacyEarly) {
			legacyEarly = false;
			mergeLegacy();
		}
	};
	if (opened) {
		announce = (keys) => {
			try {
				// `tracking` tells tracking tabs whether these writes carry their pending keys.
				const retiredVersions = liveRetired();
				const settledKeys = unsent.size ? Object.fromEntries(unsent) : null;
				unsent.clear();
				opened.channel.postMessage({
					keys,
					tracking: store.getState().sync.tracking,
					...(retiredVersions ? { retired: retiredVersions } : {}),
					...(settledKeys ? { settled: settledKeys } : {}),
				});
			} catch {
				// the channel was closed
			}
		};
		opened.channel.addEventListener("message", onMessage);
	}
	const listensToStorage =
		options.crossTab === true && typeof target.addEventListener === "function";
	if (listensToStorage) target.addEventListener?.("storage", onStorage);

	return Object.assign(store, {
		flush: () => storage.flush(),
		subscribeCommits(listener: (commit: CommitEvent) => void) {
			commitListeners.add(listener);
			return () => {
				commitListeners.delete(listener);
			};
		},
		subscribeNotices(listener: (notice: StoreNotice) => void) {
			noticeListeners.add(listener);
			return () => {
				noticeListeners.delete(listener);
			};
		},
		dispose() {
			announce = () => {};
			drainEarly = () => {};
			stopRecoveryWatch();
			stopSettleWatch();
			if (opened) {
				opened.channel.removeEventListener("message", onMessage);
				if (opened.owned) opened.channel.close?.();
			}
			if (listensToStorage) target.removeEventListener?.("storage", onStorage);
		},
	});
}

/** Snapshot of a habit log (or undefined) without subscribing. */
export function getLog(state: AtomicState, habitId: string, date: DayKey): HabitLog | undefined {
	const log = state.data.logs[logId(habitId, date)];
	return log && !log.deletedAt ? log : undefined;
}
