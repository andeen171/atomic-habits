import { type DayKey, addDays, isDayKey, toDayKey } from "../dates";
import { createId } from "../ids";
import type { AtomicData, Habit, HabitLog, Task } from "../model";
import type { AtomicStore, StoreInternals } from "../store";
import type { HabitDay } from "./measure";
import {
	type TrackerMeta,
	isForeignTracker,
	knownTracker,
	trackerMeta,
	trackerStart,
} from "./meta";
import { type TrackerEntryDraft, normalizeTrackerEntry } from "./normalize";
import { plannedLogs, reconcilePlan, reconcileWindow } from "./reconcile";
import {
	type EntryType,
	type TrackerConfig,
	type TrackerConfigInput,
	type TrackerEntry,
	isEntryType,
	trackerEntryKeyId,
} from "./schema";

/**
 * Tracker store actions (Annex K §3.3 renamed, spec §3.1), merged into
 * `AtomicActions`. They use only `StoreInternals`. Owner after Phase 1A: T4.
 *
 * Strict logging (D21): on tracker days the count comes from entries. Every
 * entry action writes the entry, the logs of the days it touched (old and
 * new day) and any task it cascades to in **one commit** (origin `"local"`).
 * Entries of unknown types (a newer build) are read-only and preserved, and
 * habits with a foreign tracker accept no entries.
 */

export interface TrackerEntryInput {
	habitId: string;
	date: DayKey;
	type: EntryType;
	/** When it happened (epoch ms); null for day-level entries. */
	at?: number | null;
	data: Record<string, unknown>;
}

/** `data` is shallow-merged into the entry's data. */
export interface TrackerEntryPatch {
	date?: DayKey;
	at?: number | null;
	data?: Record<string, unknown>;
}

export interface PlanInput {
	/** One line per priority; empty lines are ignored (at most 5 kept). */
	items: string[];
	/** The day the plan is for (default: the day after `date`). */
	for?: DayKey;
	/** Omitted: kept; null: cleared. */
	reflection?: string | null;
}

export interface TrackerActions {
	/**
	 * Validates and normalizes an entry and writes it with the day's log in one
	 * commit (Annex K §3.3 rules 1–8). Refused (null, warned) when the habit is
	 * not live, archived, has no active tracker of this type, the date is
	 * outside `trackerStart … today` (books are dated today), a `none` meets a
	 * live counted entry, or a photo is required and missing. Unique-per-day
	 * types update (or revive) their deterministic entry.
	 */
	addTrackerEntry(input: TrackerEntryInput): TrackerEntry | null;
	/** Edits a live entry (data shallow-merged, re-normalized) and reconciles its old and new day. */
	updateTrackerEntry(id: string, patch: TrackerEntryPatch): TrackerEntry | null;
	/** Tombstones the entry and the open tasks it created (plan items, same timestamp); reconciles. */
	deleteTrackerEntry(id: string): void;
	/** Undo of a delete: revives the entry and the tasks deleted with it; reconciles. */
	restoreTrackerEntry(id: string): void;
	/** The `none` entry ("No spending today"). */
	markNothingToLog(habitId: string, date: DayKey): TrackerEntry | null;
	/** Attach or replace (config) or detach (null → `enabled: false`), per Annex K §1.5. */
	setTracker(habitId: string, tracker: TrackerConfigInput | null): void;
	/**
	 * Writes the day's plan entry and its tasks in one commit (Annex K §1.8.8):
	 * new lines create tasks (`habitId: null`, `sourceEntryId: entry.id`, D17),
	 * edited lines retitle open linked tasks, removed lines delete open tasks
	 * and unlink completed ones.
	 */
	savePlan(habitId: string, date: DayKey, input: PlanInput): TrackerEntry | null;
	/**
	 * Rewrites the logs of entry-driven days from their entries
	 * (`reconcilePlan`): the given pairs, the days in a window, or every entry
	 * day when omitted. Origin `"derived"`. Returns the number of logs written.
	 * A no-op while the state is `partial` (the logs may be the missing ones).
	 */
	reconcileTrackers(pairs?: HabitDay[] | { window: [DayKey, DayKey] }): number;
}

interface Loggable {
	habit: Habit;
	config: TrackerConfig;
	meta: TrackerMeta;
}

function nextOrder(records: Record<string, { order: number; deletedAt: number | null }>): number {
	let max = -1;
	for (const r of Object.values(records)) if (!r.deletedAt && r.order > max) max = r.order;
	return max + 1;
}

/** The live entries of a habit-day of the given types. */
function liveOfTypes(
	entries: Record<string, TrackerEntry>,
	habitId: string,
	date: DayKey,
	types: readonly string[],
	exceptId?: string,
): TrackerEntry[] {
	const out: TrackerEntry[] = [];
	for (const entry of Object.values(entries)) {
		if (entry.deletedAt || entry.habitId !== habitId || entry.date !== date) continue;
		if (entry.id === exceptId || !types.includes(entry.type)) continue;
		out.push(entry);
	}
	return out;
}

/** Entity ids are at most 80 characters (spec §2.1). */
const MAX_ID = 80;

/**
 * The id of a new plan line's task: `${planId}:${n}`, the first `n` no task
 * record uses (live or deleted). Two devices that each save the day's plan
 * offline create the same ids, so their tasks merge by last-write-wins
 * instead of leaving duplicates that no plan item links (reverify K5). A
 * plan id too long for that falls back to a random id.
 */
function planTaskId(planId: string, tasks: Readonly<Record<string, Task>>, taken: Set<string>) {
	for (let n = 0; n < 1000; n++) {
		const id = `${planId}:${n}`;
		if (id.length > MAX_ID) break;
		if (tasks[id] || taken.has(id)) continue;
		taken.add(id);
		return id;
	}
	return createId();
}

const hasPhotos = (data: Record<string, unknown>) =>
	Array.isArray(data.photos) && data.photos.length > 0;

export function createTrackerActions(internals: StoreInternals): TrackerActions {
	const data = () => internals.get().data;
	const refuse = (why: string): null => {
		console.warn(`[atomic] Tracker entry refused: ${why}`);
		return null;
	};

	/** The habit if entries can be written to it now (live, not archived, an active known tracker). */
	const loggable = (habitId: string): Loggable | null => {
		const habit = data().habits[habitId];
		if (!habit || habit.deletedAt) return refuse(`${habitId} is not a live habit`);
		if (habit.archivedAt) return refuse(`${habitId} is archived`);
		if (isForeignTracker(habit)) return refuse(`${habitId} has a tracker from a newer version`);
		const config = knownTracker(habit);
		if (!config || config.enabled === false) return refuse(`${habitId} has no active tracker`);
		return { habit, config, meta: trackerMeta(config) };
	};

	/** Counted (and `none`) entries need `trackerStart ≤ date ≤ today`; books are exempt. */
	const inBounds = (habit: Habit, type: string, date: DayKey): boolean => {
		if (type === "book") return true;
		if (!isDayKey(date)) return false;
		return date >= trackerStart(habit) && date <= internals.today();
	};

	/** Photo trackers refuse an entry without photos while `photoRequired` is on (spec §2.3). */
	const photoMissing = (config: TrackerConfig, type: string, entryData: Record<string, unknown>) =>
		type === "photo" &&
		config.type === "photo" &&
		config.photoRequired !== false &&
		!hasPhotos(entryData);

	/**
	 * The logs of the given days after `entries` replace the store's tracker
	 * entries (the same commit's writes), and the habit changes if any.
	 */
	const logsFor = (
		pairs: HabitDay[],
		next: Partial<Pick<AtomicData, "trackerEntries" | "habits">>,
	): HabitLog[] => {
		const current = data();
		const view = {
			habits: next.habits ?? current.habits,
			logs: current.logs,
			trackerEntries: next.trackerEntries ?? current.trackerEntries,
		};
		const { superseded } = internals.get().sync;
		return plannedLogs(view, reconcilePlan(view, pairs, { superseded }), internals.stamp);
	};

	/** Entries merged over the store's, by id. */
	const withEntries = (written: readonly TrackerEntry[]): Record<string, TrackerEntry> => {
		const entries = { ...data().trackerEntries };
		for (const entry of written) entries[entry.id] = entry;
		return entries;
	};

	const tombstone = <T extends { updatedAt: number }>(entity: T, at: number): T => ({
		...entity,
		deletedAt: at,
		updatedAt: internals.stamp(entity),
	});

	/** Validates the draft into a stored entry (keeps `createdAt` and unknown fields of `base`). */
	const entryFrom = (
		draft: TrackerEntryDraft & { id: string },
		base: TrackerEntry | undefined,
	): TrackerEntry | null => {
		const t = internals.stamp(base);
		return internals.validated("trackerEntries", {
			...base,
			id: draft.id,
			habitId: draft.habitId,
			date: draft.date,
			type: draft.type,
			at: draft.at,
			data: draft.data,
			createdAt: base?.createdAt ?? t,
			updatedAt: t,
			deletedAt: null,
		});
	};

	/** A counted entry tombstones the day's `none` (exclusivity, Annex K §1.4). */
	const noneToClear = (
		meta: TrackerMeta,
		type: string,
		habitId: string,
		date: DayKey,
		at: number,
	): TrackerEntry[] => {
		if (!meta.allowsNone || !meta.counted.includes(type as EntryType)) return [];
		return liveOfTypes(data().trackerEntries, habitId, date, ["none"]).map((none) =>
			tombstone(none, at),
		);
	};

	const stored = (entry: TrackerEntry): TrackerEntry | null =>
		data().trackerEntries[entry.id] === entry ? entry : null;

	const actions: TrackerActions = {
		addTrackerEntry(input) {
			const target = loggable(input.habitId);
			if (!target) return null;
			const { habit, config, meta } = target;
			const type = input.type;
			if (!isEntryType(type) || !meta.entryTypes.includes(type)) {
				return refuse(`${String(type)} is not an entry type of ${config.type}`);
			}
			if (type === "plan") {
				const raw = Array.isArray(input.data?.items) ? input.data.items : [];
				return actions.savePlan(input.habitId, input.date, {
					items: raw.map((item) =>
						typeof item === "string" ? item : String((item as { text?: unknown })?.text ?? ""),
					),
					for: typeof input.data?.for === "string" ? input.data.for : undefined,
					reflection: (input.data?.reflection as string | null | undefined) ?? undefined,
				});
			}
			const today = internals.today();
			const date = type === "book" ? today : input.date;
			if (!inBounds(habit, type, date)) return refuse(`${date} is outside the tracker's days`);
			const entries = data().trackerEntries;
			if (type === "none") {
				const counted = liveOfTypes(entries, habit.id, date, meta.counted);
				if (counted.length) return refuse("the day already has entries");
			}
			const unique = meta.uniquePerDay.includes(type);
			const id = unique ? trackerEntryKeyId(habit.id, type, date) : createId();
			const existing = unique ? entries[id] : undefined;
			const live = existing && !existing.deletedAt ? existing : undefined;
			const draft = normalizeTrackerEntry(
				{
					id,
					habitId: habit.id,
					date,
					type,
					at: input.at !== undefined ? input.at : (live?.at ?? null),
					data: { ...(live?.data ?? {}), ...(input.data ?? {}) },
				},
				{ config, entries, now: internals.now() },
			);
			if (photoMissing(config, type, draft.data)) return refuse("a photo is required");
			const entry = entryFrom({ ...draft, id }, existing);
			if (!entry) return null;
			const cleared = noneToClear(meta, type, habit.id, date, internals.now());
			const written = [entry, ...cleared];
			const logs = logsFor([{ habitId: habit.id, date }], {
				trackerEntries: withEntries(written),
			});
			internals.commit({ trackerEntries: written, logs });
			return stored(entry);
		},

		updateTrackerEntry(id, patch) {
			const current = data().trackerEntries[id];
			if (!current || current.deletedAt) return refuse(`${id} is not a live entry`);
			if (!isEntryType(current.type)) return refuse(`${id} has a type from a newer version`);
			const target = loggable(current.habitId);
			if (!target) return null;
			const { habit, config, meta } = target;
			const type = current.type;
			if (!meta.entryTypes.includes(type)) return refuse(`${id} belongs to another tracker type`);
			const date = patch.date ?? current.date;
			const merged = { ...(current.data ?? {}), ...(patch.data ?? {}) };
			if (type === "plan") {
				if (date !== current.date) return refuse("a plan can't move to another day");
				const items = Array.isArray(merged.items) ? merged.items : [];
				return actions.savePlan(habit.id, date, {
					items: items.map((item) =>
						typeof item === "string" ? item : String((item as { text?: unknown })?.text ?? ""),
					),
					for: typeof merged.for === "string" ? merged.for : undefined,
					reflection: (merged.reflection as string | null | undefined) ?? null,
				});
			}
			if (date !== current.date) {
				// Unique-per-day entries are keyed by their day; delete and add instead.
				if (meta.uniquePerDay.includes(type)) return refuse(`${type} entries can't change day`);
				if (!inBounds(habit, type, date)) return refuse(`${date} is outside the tracker's days`);
			}
			const draft = normalizeTrackerEntry(
				{
					id,
					habitId: current.habitId,
					date,
					type,
					at: patch.at !== undefined ? patch.at : current.at,
					data: merged,
				},
				{ config, entries: data().trackerEntries, now: internals.now() },
			);
			if (photoMissing(config, type, draft.data)) return refuse("a photo is required");
			const entry = entryFrom({ ...draft, id }, current);
			if (!entry) return null;
			const cleared =
				date !== current.date ? noneToClear(meta, type, habit.id, date, internals.now()) : [];
			const written = [entry, ...cleared];
			const pairs = [{ habitId: habit.id, date: current.date }];
			if (date !== current.date) pairs.push({ habitId: habit.id, date });
			const logs = logsFor(pairs, { trackerEntries: withEntries(written) });
			internals.commit({ trackerEntries: written, logs });
			return stored(entry);
		},

		deleteTrackerEntry(id) {
			const current = data().trackerEntries[id];
			if (!current || current.deletedAt) return;
			if (!isEntryType(current.type)) {
				refuse(`${id} has a type from a newer version`);
				return;
			}
			const habit = data().habits[current.habitId];
			if (habit && (habit.deletedAt || habit.archivedAt || isForeignTracker(habit))) {
				refuse(`${current.habitId} is read-only`);
				return;
			}
			const t = internals.now();
			const entry = tombstone(current, t);
			// Spec §2.5: open tasks the entry created go with it, with the same timestamp.
			const tasks = Object.values(data().tasks)
				.filter((task) => !task.deletedAt && task.completedAt == null && task.sourceEntryId === id)
				.map((task) => tombstone(task, t));
			const logs = logsFor([{ habitId: current.habitId, date: current.date }], {
				trackerEntries: withEntries([entry]),
			});
			internals.commit({ trackerEntries: [entry], tasks, logs });
		},

		restoreTrackerEntry(id) {
			const current = data().trackerEntries[id];
			if (!current?.deletedAt) return;
			if (!isEntryType(current.type)) {
				refuse(`${id} has a type from a newer version`);
				return;
			}
			const target = loggable(current.habitId);
			if (!target) return;
			const { habit, meta } = target;
			const type = current.type;
			const entries = data().trackerEntries;
			if (type === "none" && liveOfTypes(entries, habit.id, current.date, meta.counted).length) {
				refuse("the day already has entries");
				return;
			}
			const deletedAt = current.deletedAt;
			const entry: TrackerEntry = {
				...current,
				deletedAt: null,
				updatedAt: internals.stamp(current),
			};
			const cleared = noneToClear(meta, type, habit.id, current.date, internals.now());
			const tasks: Task[] = Object.values(data().tasks)
				.filter((task) => task.deletedAt === deletedAt && task.sourceEntryId === id)
				.map((task) => ({ ...task, deletedAt: null, updatedAt: internals.stamp(task) }));
			const written = [entry, ...cleared];
			const logs = logsFor([{ habitId: habit.id, date: current.date }], {
				trackerEntries: withEntries(written),
			});
			internals.commit({ trackerEntries: written, tasks, logs });
		},

		markNothingToLog(habitId, date) {
			return actions.addTrackerEntry({ habitId, date, type: "none", data: {} });
		},

		setTracker(habitId, tracker) {
			// `updateHabit` applies Annex K §1.5 and reconciles the habit's entry days.
			internals.get().actions.updateHabit(habitId, { tracker });
		},

		savePlan(habitId, date, input) {
			const target = loggable(habitId);
			if (!target) return null;
			const { habit, config, meta } = target;
			if (!meta.entryTypes.includes("plan")) return refuse(`${config.type} has no plans`);
			if (!inBounds(habit, "plan", date)) return refuse(`${date} is outside the tracker's days`);
			const lines = (input.items ?? [])
				.map((line) => (typeof line === "string" ? line.trim().slice(0, 280) : ""))
				.filter(Boolean)
				.slice(0, 5);
			if (!lines.length) return refuse("a plan needs at least one item");
			const forDay = input.for && isDayKey(input.for) ? input.for : addDays(date, 1);
			const id = trackerEntryKeyId(habitId, "plan", date);
			const { trackerEntries: entries, tasks: allTasks } = data();
			const existing = entries[id];
			const live = existing && !existing.deletedAt ? existing : undefined;
			// Each old item keeps its raw object, so keys a newer build wrote survive a re-save (§2.1).
			const oldItems = (Array.isArray(live?.data.items) ? live.data.items : []).map((item) => {
				const raw: Record<string, unknown> =
					item && typeof item === "object" && !Array.isArray(item) ? { ...item } : {};
				return {
					raw,
					text: typeof raw.text === "string" ? raw.text.trim() : "",
					taskId: typeof raw.taskId === "string" ? raw.taskId : null,
				};
			});

			// Lines keep their task: same text first, then the remaining ones in order.
			const used = new Set<number>();
			const pairedWith: (number | null)[] = lines.map((line) => {
				const index = oldItems.findIndex((item, i) => !used.has(i) && item.text === line);
				if (index < 0) return null;
				used.add(index);
				return index;
			});
			const remaining = oldItems.map((_, i) => i).filter((i) => !used.has(i));
			for (let i = 0; i < lines.length; i++) {
				if (pairedWith[i] !== null) continue;
				const next = remaining.shift();
				if (next === undefined) break;
				used.add(next);
				pairedWith[i] = next;
			}

			const t = internals.now();
			const lang = internals.translator().locale;
			let order = nextOrder(allTasks);
			const tasks: Task[] = [];
			const taken = new Set<string>();
			const items = lines.map((text, i) => {
				const index = pairedWith[i];
				const old = index != null ? oldItems[index] : undefined;
				const task = old?.taskId ? allTasks[old.taskId] : undefined;
				if (old?.taskId) {
					// A deleted task stays deleted; a completed one keeps its title.
					if (task && !task.deletedAt && task.completedAt == null) {
						if (task.title !== text || task.date !== forDay) {
							tasks.push({ ...task, title: text, date: forDay, updatedAt: internals.stamp(task) });
						}
					}
					return { ...old.raw, text, taskId: old.taskId };
				}
				const ts = internals.stamp();
				const created = internals.validated("tasks", {
					id: planTaskId(id, allTasks, taken),
					title: text,
					notes: null,
					date: forDay,
					priority: 2,
					completedAt: null,
					identityId: habit.identityId,
					order: order++,
					repeat: null,
					time: null,
					habitId: null,
					law: null,
					habitField: null,
					sourceEntryId: id,
					lang,
					createdAt: ts,
					updatedAt: ts,
					deletedAt: null,
				});
				if (created) tasks.push(created);
				return { ...old?.raw, text, taskId: created?.id ?? null };
			});
			// Removed lines: open tasks are deleted, completed ones unlinked.
			oldItems.forEach((item, i) => {
				if (used.has(i) || !item.taskId) return;
				const task = allTasks[item.taskId];
				if (!task || task.deletedAt) return;
				tasks.push(
					task.completedAt == null
						? tombstone(task, t)
						: { ...task, sourceEntryId: null, updatedAt: internals.stamp(task) },
				);
			});

			const reflection =
				input.reflection === undefined ? (live?.data.reflection ?? null) : input.reflection;
			const draft = normalizeTrackerEntry(
				{
					id,
					habitId,
					date,
					type: "plan",
					at: live?.at ?? null,
					data: { ...(live?.data ?? {}), items, for: forDay, reflection },
				},
				{ config, entries, now: t },
			);
			const entry = entryFrom({ ...draft, id }, existing);
			if (!entry) return null;
			const logs = logsFor([{ habitId, date }], { trackerEntries: withEntries([entry]) });
			internals.commit({ trackerEntries: [entry], tasks, logs });
			return stored(entry);
		},

		reconcileTrackers(pairs) {
			if (internals.get().partial) return 0;
			const scope = pairs === undefined ? "all" : pairs;
			const current = data();
			const { superseded } = internals.get().sync;
			const plan = reconcilePlan(current, scope, { superseded });
			const logs = plannedLogs(current, plan, internals.stamp);
			if (!logs.length) return 0;
			internals.commit({ logs }, { origin: "derived" });
			const after = data().logs;
			return logs.filter((log) => after[log.id] === log).length;
		},
	};
	return actions;
}

/**
 * Day change (spec §3.1): reconciles `[today − 35, today]` whenever the local
 * day rolls over (checked every `everyMs`, so a device waking from sleep
 * catches up too). App start is covered by the store itself, after
 * hydration. Returns a stop function. The apps start it next to the sync
 * controller.
 */
export function watchTrackerDays(
	store: Pick<AtomicStore, "getState">,
	options: { now?: () => number; everyMs?: number } = {},
): () => void {
	const now = options.now ?? Date.now;
	let day = toDayKey(now());
	const id = setInterval(() => {
		const today = toDayKey(now());
		if (today === day) return;
		day = today;
		try {
			store.getState().actions.reconcileTrackers({ window: reconcileWindow(today) });
		} catch (error) {
			console.warn("[atomic] Day-change tracker reconciliation failed", error);
		}
	}, options.everyMs ?? 60_000);
	return () => clearInterval(id);
}
