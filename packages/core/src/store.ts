import { persist } from "zustand/middleware";
import { type StoreApi, createStore } from "zustand/vanilla";
import { type DayKey, toDayKey } from "./dates";
import { buildDemoData } from "./demo";
import { createId } from "./ids";
import {
	type AtomicData,
	COLLECTIONS,
	type Collection,
	DEFAULT_SETTINGS,
	EXPORT_FORMAT,
	type EntityByCollection,
	type ExportFile,
	type Habit,
	type HabitLog,
	type Identity,
	type ScorecardItem,
	type Settings,
	type Task,
	collectionSchemas,
	emptyData,
	exportFileSchema,
	habitSchema,
	identitySchema,
	logId,
	scorecardItemSchema,
	settingsSchema,
	taskSchema,
} from "./model";
import {
	type FlushablePersistStorage,
	type KeyValueStorage,
	createMemoryStorage,
	createPersistStorage,
} from "./storage";
import { type SyncRecord, pendingKey, shouldReplace } from "./sync";

type Editable<T> = Omit<T, "id" | "createdAt" | "updatedAt" | "deletedAt">;

export type HabitInput = Partial<Editable<Habit>> & { name: string };
export type HabitPatch = Partial<Editable<Habit>>;
export type IdentityInput = Partial<Editable<Identity>> & { statement: string };
export type IdentityPatch = Partial<Editable<Identity>>;
export type TaskInput = Partial<Editable<Task>> & { title: string };
export type TaskPatch = Partial<Editable<Task>>;
export type ScorecardInput = Partial<Editable<ScorecardItem>> & { label: string };
export type ScorecardPatch = Partial<Editable<ScorecardItem>>;

export interface SyncMeta {
	/** Last server sequence pulled. */
	cursor: number;
	/** Entities changed locally since the last successful push. */
	pending: Record<string, true>;
	lastSyncedAt: number | null;
}

export interface ImportResult {
	ok: boolean;
	imported: number;
	error?: string;
}

export interface AtomicActions {
	createHabit(input: HabitInput): Habit;
	updateHabit(id: string, patch: HabitPatch): void;
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
	exportData(): ExportFile;
	importData(file: unknown, mode?: "merge" | "replace"): ImportResult;
	/** Replace everything with a realistic sample history (for exploring). */
	loadDemoData(locale?: string): void;
	/** Wipe all local data and settings on this device. */
	resetAll(): void;

	/** Merge documents pulled from the sync server. Returns how many changed. */
	applyRemote(records: SyncRecord[]): number;
	setSyncMeta(patch: Partial<SyncMeta>): void;
}

export interface AtomicState {
	data: AtomicData;
	settings: Settings;
	sync: SyncMeta;
	/** True once persisted state has been loaded. */
	hydrated: boolean;
	actions: AtomicActions;
}

type PersistedState = Pick<AtomicState, "data" | "settings" | "sync">;

export type AtomicStore = StoreApi<AtomicState> & {
	/** Persist pending writes now (call when the app goes to background). */
	flush(): Promise<void>;
};

export interface CreateStoreOptions {
	storage?: KeyValueStorage;
	/** Storage key. */
	name?: string;
	now?: () => number;
	debounceMs?: number;
}

export const STORE_VERSION = 1;
const emptySync = (): SyncMeta => ({ cursor: 0, pending: {}, lastSyncedAt: null });

const clean = (value: string | null | undefined): string | null => {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : null;
};

function sanitizeHabit<T extends HabitPatch>(patch: T): T {
	const out = { ...patch };
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

export function createAtomicStore(options: CreateStoreOptions = {}): AtomicStore {
	const now = options.now ?? Date.now;
	const kv = options.storage ?? createMemoryStorage();
	const storage: FlushablePersistStorage<PersistedState> = createPersistStorage(kv, {
		debounceMs: options.debounceMs,
	});
	let markHydrated: () => void = () => {};

	const store = createStore<AtomicState>()(
		persist(
			(set, get) => {
				markHydrated = () => set({ hydrated: true });

				/** Write entities and mark them for sync. */
				const put = <C extends Collection>(collection: C, ...entities: EntityByCollection[C][]) => {
					if (!entities.length) return;
					set((state) => {
						const records = { ...state.data[collection] } as Record<string, EntityByCollection[C]>;
						const pending = { ...state.sync.pending };
						for (const entity of entities) {
							records[entity.id] = entity;
							pending[pendingKey(collection, entity.id)] = true;
						}
						return {
							data: { ...state.data, [collection]: records },
							sync: { ...state.sync, pending },
						};
					});
				};

				const patch = <C extends Collection>(
					collection: C,
					id: string,
					changes: Partial<EntityByCollection[C]>,
				) => {
					const current = get().data[collection][id] as EntityByCollection[C] | undefined;
					if (!current) return;
					put(collection, { ...current, ...changes, id, updatedAt: now() });
				};

				const writeLog = (habitId: string, date: DayKey, changes: Partial<HabitLog>) => {
					const id = logId(habitId, date);
					const current = get().data.logs[id];
					const t = now();
					const base: HabitLog = current ?? {
						id,
						habitId,
						date,
						count: 0,
						skipped: false,
						note: null,
						createdAt: t,
						updatedAt: t,
						deletedAt: null,
					};
					put("logs", { ...base, ...changes, id, habitId, date, deletedAt: null, updatedAt: t });
				};

				const actions: AtomicActions = {
					createHabit(input) {
						const t = now();
						const habit = habitSchema.parse({
							startDate: toDayKey(t),
							order: nextOrder(get().data.habits),
							...sanitizeHabit(input),
							id: createId(),
							createdAt: t,
							updatedAt: t,
							deletedAt: null,
						});
						put("habits", habit);
						return habit;
					},
					updateHabit(id, changes) {
						const current = get().data.habits[id];
						if (!current) return;
						const next = habitSchema.safeParse({
							...current,
							...sanitizeHabit(changes),
							updatedAt: now(),
						});
						if (next.success) put("habits", next.data);
						else console.warn("[atomic] Ignored invalid habit update", next.error.issues);
					},
					archiveHabit(id, archived = true) {
						patch("habits", id, { archivedAt: archived ? now() : null });
					},
					deleteHabit(id) {
						patch("habits", id, { deletedAt: now() });
					},
					restoreHabit(id) {
						patch("habits", id, { deletedAt: null });
					},
					reorderHabits(ids) {
						const t = now();
						const habits = get().data.habits;
						const changed: Habit[] = [];
						ids.forEach((id, order) => {
							const habit = habits[id];
							if (habit && habit.order !== order) changed.push({ ...habit, order, updatedAt: t });
						});
						put("habits", ...changed);
					},

					setCount(habitId, date, count) {
						if (!get().data.habits[habitId]) return;
						const value = Math.max(0, Math.min(100_000, Math.round(count)));
						writeLog(
							habitId,
							date,
							value > 0 ? { count: value, skipped: false } : { count: value },
						);
					},
					increment(habitId, date, delta = 1) {
						const current = get().data.logs[logId(habitId, date)]?.count ?? 0;
						actions.setCount(habitId, date, current + delta);
					},
					toggleHabit(habitId, date) {
						const habit = get().data.habits[habitId];
						if (!habit) return;
						const current = get().data.logs[logId(habitId, date)]?.count ?? 0;
						if (habit.kind === "break") {
							actions.setCount(habitId, date, current > 0 ? 0 : 1);
						} else {
							actions.setCount(habitId, date, current >= habit.target ? 0 : habit.target);
						}
					},
					setSkipped(habitId, date, skipped) {
						if (!get().data.habits[habitId]) return;
						writeLog(habitId, date, skipped ? { skipped, count: 0 } : { skipped });
					},
					setNote(habitId, date, note) {
						if (!get().data.habits[habitId]) return;
						writeLog(habitId, date, { note: clean(note) });
					},

					createIdentity(input) {
						const t = now();
						const identity = identitySchema.parse({
							order: nextOrder(get().data.identities),
							...input,
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
						patch("identities", id, next);
					},
					deleteIdentity(id) {
						const t = now();
						const habits = Object.values(get().data.habits)
							.filter((h) => h.identityId === id)
							.map((h) => ({ ...h, identityId: null, updatedAt: t }));
						const tasks = Object.values(get().data.tasks)
							.filter((task) => task.identityId === id)
							.map((task) => ({ ...task, identityId: null, updatedAt: t }));
						put("habits", ...habits);
						put("tasks", ...tasks);
						patch("identities", id, { deletedAt: t });
					},

					createTask(input) {
						const t = now();
						const task = taskSchema.parse({
							order: nextOrder(get().data.tasks),
							...input,
							title: input.title.trim(),
							notes: clean(input.notes),
							id: createId(),
							createdAt: t,
							updatedAt: t,
							deletedAt: null,
						});
						put("tasks", task);
						return task;
					},
					updateTask(id, changes) {
						const next = { ...changes };
						if (typeof next.title === "string") next.title = next.title.trim();
						if (next.title === "") return;
						if ("notes" in next) next.notes = clean(next.notes);
						patch("tasks", id, next);
					},
					toggleTask(id) {
						const task = get().data.tasks[id];
						if (!task) return;
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
						const done = Object.values(get().data.tasks)
							.filter((task) => task.completedAt && !task.deletedAt)
							.map((task) => ({ ...task, deletedAt: t, updatedAt: t }));
						put("tasks", ...done);
					},

					createScorecardItem(input) {
						const t = now();
						const item = scorecardItemSchema.parse({
							order: nextOrder(get().data.scorecard),
							...input,
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
						patch("scorecard", id, next);
					},
					deleteScorecardItem(id) {
						patch("scorecard", id, { deletedAt: now() });
					},
					reorderScorecard(ids) {
						const t = now();
						const items = get().data.scorecard;
						const changed: ScorecardItem[] = [];
						ids.forEach((id, order) => {
							const item = items[id];
							if (item && item.order !== order) changed.push({ ...item, order, updatedAt: t });
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
							version: 1,
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
							},
						};
					},
					importData(file, mode = "merge") {
						const parsed = exportFileSchema.safeParse(file);
						if (!parsed.success) {
							return { ok: false, imported: 0, error: "invalid-file" };
						}
						const incoming = parsed.data;
						let imported = 0;
						set((state) => {
							const data: AtomicData = mode === "replace" ? emptyData() : { ...state.data };
							const pending = mode === "replace" ? {} : { ...state.sync.pending };
							for (const collection of COLLECTIONS) {
								const records = { ...data[collection] } as Record<
									string,
									{ id: string; updatedAt: number }
								>;
								for (const entity of incoming.data[collection]) {
									if (mode === "merge" && !shouldReplace(records[entity.id], entity)) continue;
									records[entity.id] = entity;
									pending[pendingKey(collection, entity.id)] = true;
									imported++;
								}
								(data as Record<Collection, unknown>)[collection] = records;
							}
							const settings =
								mode === "replace" && incoming.settings
									? settingsSchema.parse({
											...state.settings,
											...incoming.settings,
											onboarded: true,
										})
									: { ...state.settings, onboarded: true };
							return { data, settings, sync: { ...state.sync, pending } };
						});
						return { ok: true, imported };
					},
					loadDemoData(locale) {
						const demo = buildDemoData({
							today: toDayKey(now()),
							now: now(),
							locale: locale ?? get().settings.locale,
						});
						const pending: Record<string, true> = {};
						for (const collection of COLLECTIONS) {
							for (const id of Object.keys(demo[collection])) {
								pending[pendingKey(collection, id)] = true;
							}
						}
						set((state) => ({
							data: demo,
							settings: { ...state.settings, onboarded: true },
							sync: { ...state.sync, pending },
						}));
					},
					resetAll() {
						set({ data: emptyData(), settings: { ...DEFAULT_SETTINGS }, sync: emptySync() });
					},

					applyRemote(records) {
						let changed = 0;
						set((state) => {
							const data = { ...state.data } as Record<
								Collection,
								Record<string, { updatedAt: number }>
							>;
							const pending = { ...state.sync.pending };
							const touched = new Set<Collection>();
							for (const record of records) {
								const schema = collectionSchemas[record.collection];
								const parsed = schema.safeParse({
									...record.data,
									id: record.id,
									updatedAt: record.updatedAt,
									deletedAt: record.deletedAt,
								});
								if (!parsed.success) continue;
								const current = data[record.collection][record.id];
								if (!shouldReplace(current, parsed.data)) continue;
								if (!touched.has(record.collection)) {
									data[record.collection] = { ...data[record.collection] };
									touched.add(record.collection);
								}
								data[record.collection][record.id] = parsed.data;
								delete pending[pendingKey(record.collection, record.id)];
								changed++;
							}
							if (!changed) return state;
							return {
								data: data as unknown as AtomicData,
								sync: { ...state.sync, pending },
							};
						});
						return changed;
					},
					setSyncMeta(changes) {
						set((state) => ({ sync: { ...state.sync, ...changes } }));
					},
				};

				return {
					data: emptyData(),
					settings: { ...DEFAULT_SETTINGS },
					sync: emptySync(),
					hydrated: false,
					actions,
				};
			},
			{
				name: options.name ?? "atomic-habits",
				version: STORE_VERSION,
				storage,
				partialize: (state): PersistedState => ({
					data: state.data,
					settings: state.settings,
					sync: state.sync,
				}),
				merge: (persisted, current) => {
					const p = (persisted ?? {}) as Partial<PersistedState>;
					const data = emptyData();
					if (p.data && typeof p.data === "object") {
						for (const collection of COLLECTIONS) {
							const records = p.data[collection];
							if (records && typeof records === "object") {
								(data as Record<Collection, unknown>)[collection] = records;
							}
						}
					}
					const settings = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...p.settings });
					return {
						...current,
						data,
						settings: settings.success ? settings.data : { ...DEFAULT_SETTINGS },
						sync: { ...emptySync(), ...p.sync },
					};
				},
				onRehydrateStorage: () => () => markHydrated(),
			},
		),
	);

	return Object.assign(store, { flush: () => storage.flush() });
}

/** Snapshot of a habit log (or undefined) without subscribing. */
export function getLog(state: AtomicState, habitId: string, date: DayKey): HabitLog | undefined {
	const log = state.data.logs[logId(habitId, date)];
	return log && !log.deletedAt ? log : undefined;
}
