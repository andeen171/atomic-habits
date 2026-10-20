import { describe, expect, test } from "bun:test";
import { ATTACHMENT_MIMES, attachmentRefSchema } from "../src/attachments";
import { daysInMonth, monthKeyOf } from "../src/dates";
import { FEATURES } from "../src/flags";
import {
	COLLECTIONS,
	DEFAULT_SETTINGS,
	SCHEMA_REV,
	V1_COLLECTIONS,
	collectionSchemas,
	emptyData,
	exportFileSchema,
	habitSchema,
	hasAnyData,
	journalEntrySchema,
	settingsSchema,
	taskLogId,
	taskSchema,
	translationId,
} from "../src/model";
import { CUE_TYPES, monthKeySchema, weekdaySchema } from "../src/primitives";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, createAtomicStore } from "../src/store";
import { SCHEMA_REV as WIRE_SCHEMA_REV, V1_COLLECTIONS as WIRE_V1 } from "../src/sync";
import {
	ENTRY_DATA,
	ENTRY_TYPES,
	TRACKER_TYPES,
	asTyped,
	trackerConfigSchema,
	trackerEntryKeyId,
	trackerEntrySchema,
} from "../src/trackers/schema";
import { LEGACY_DEFAULT_EMOJI, upgradeRecord } from "../src/upgrade";
import { SRC, runtimeCycles, sourceFiles, srcPath } from "./support/import-graph";
import {
	ENTRY_SAMPLES,
	REPEAT_RULES,
	TRACKER_CONFIGS,
	futurePaths,
	maximalDocuments,
	withFuture,
} from "./support/v2-documents";

/** What every write path stores (spec §2.1): unknown top-level keys survive the merge. */
function store(collection: (typeof COLLECTIONS)[number], raw: Record<string, unknown>) {
	const parsed = collectionSchemas[collection].safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`${collection}/${String(raw.id)} failed: ${JSON.stringify(parsed.error.issues, null, 1)}`,
		);
	}
	return { ...raw, ...(parsed.data as Record<string, unknown>) };
}

describe("v2 collections", () => {
	test("COLLECTIONS is append-only over v1 and SCHEMA_REV is 2", () => {
		expect(COLLECTIONS.slice(0, V1_COLLECTIONS.length)).toEqual([...V1_COLLECTIONS]);
		expect(COLLECTIONS.slice(V1_COLLECTIONS.length)).toEqual([
			"taskLogs",
			"journal",
			"trackerEntries",
			"translations",
		]);
		expect(SCHEMA_REV).toBe(2);
		// The wire module serves the same bindings.
		expect(WIRE_SCHEMA_REV).toBe(SCHEMA_REV);
		expect(WIRE_V1).toBe(V1_COLLECTIONS);
		for (const c of COLLECTIONS) {
			expect(collectionSchemas[c]).toBeDefined();
			expect(emptyData()[c]).toEqual({});
			expect(/^[a-z][a-zA-Z0-9]{0,39}$/.test(c)).toBe(true);
		}
	});

	test("fixtures cover every known tracker, entry type and repeat rule", () => {
		for (const type of TRACKER_TYPES) expect(TRACKER_CONFIGS[type]).toBeDefined();
		for (const type of ENTRY_TYPES) expect(ENTRY_SAMPLES[type]).toBeDefined();
		for (const type of ["days", "weeks", "months", "after"]) {
			expect(REPEAT_RULES[type]).toBeDefined();
		}
		expect(Object.keys(maximalDocuments()).sort()).toEqual([...COLLECTIONS].sort());
	});

	test("maximal documents round-trip exactly through schema parse", () => {
		for (const [collection, docs] of Object.entries(maximalDocuments())) {
			for (const doc of docs) {
				const stored = store(collection as (typeof COLLECTIONS)[number], doc);
				expect(stored).toEqual(doc);
			}
		}
	});

	test("__future at every object level survives schema parse", () => {
		let checked = 0;
		for (const [collection, docs] of Object.entries(maximalDocuments())) {
			for (const doc of docs) {
				const injected = withFuture(doc);
				const paths = futurePaths(injected);
				expect(paths.length).toBeGreaterThan(0);
				const stored = store(collection as (typeof COLLECTIONS)[number], injected);
				expect(futurePaths(stored)).toEqual(paths);
				expect(stored).toEqual(injected);
				checked += paths.length;
			}
		}
		// Sanity: the injection reaches nested objects, not just the top level.
		expect(checked).toBeGreaterThan(100);
	});

	test("v1 documents parse unchanged and gain the v2 defaults", () => {
		const habit = habitSchema.parse({
			id: "h",
			name: "Run",
			createdAt: 1,
			updatedAt: 1,
			startDate: "2026-01-01",
		});
		expect(habit).toMatchObject({
			emoji: "✨",
			emojiAuto: false,
			goalHistory: [],
			levelUp: null,
			tracker: null,
			lang: null,
		});
		const task = taskSchema.parse({ id: "t", title: "Call", createdAt: 1, updatedAt: 1 });
		expect(task).toMatchObject({
			repeat: null,
			time: null,
			habitId: null,
			law: null,
			habitField: null,
			sourceEntryId: null,
			lang: null,
		});
		for (const c of ["identities", "scorecard"] as const) {
			const base = c === "identities" ? { statement: "I run" } : { label: "Coffee" };
			const parsed = collectionSchemas[c].parse({ id: "x", createdAt: 1, updatedAt: 1, ...base });
			expect(parsed.lang).toBeNull();
		}
	});

	test("v1 settings and v1 backups parse with v2 defaults", () => {
		expect(settingsSchema.parse({ locale: "en" })).toMatchObject({
			reviewCadence: "weekly",
			typingSuggestions: true,
			contentLanguage: "follow",
			backupPhotos: true,
			syncJournal: true,
		});
		expect(DEFAULT_SETTINGS.syncJournal).toBe(true);
		const file = exportFileSchema.parse({
			format: "atomic-habits-export",
			version: 1,
			exportedAt: 1,
			data: { habits: [], logs: [], tasks: [], identities: [], scorecard: [] },
		});
		expect(file.data.taskLogs).toEqual([]);
		expect(file.data.journal).toEqual([]);
		expect(file.data.trackerEntries).toEqual([]);
		expect(file.data.translations).toEqual([]);
	});
});

describe("open discriminators", () => {
	test("unknown tracker types are kept verbatim; known types must be valid", () => {
		const foreign = { type: "garden", enabled: false, since: null, beds: [{ name: "Herbs" }] };
		expect(trackerConfigSchema.parse(foreign)).toEqual(foreign);
		// A known type with an invalid config is not smuggled through the foreign branch.
		expect(trackerConfigSchema.safeParse({ type: "expense", currency: "usd" }).success).toBe(false);
		expect(trackerConfigSchema.parse({ type: "workout" })).toMatchObject({
			enabled: true,
			since: null,
			defaultActivity: null,
		});
		expect(trackerConfigSchema.parse({ type: "photo" })).toMatchObject({
			photoRequired: true,
			prompt: null,
			compare: false,
		});
	});

	test("future repeat rules are kept; known rule types must be valid", () => {
		const base = { id: "t", title: "Water plants", createdAt: 1, updatedAt: 1 };
		const future = { type: "lunar", phase: "full" };
		expect(taskSchema.parse({ ...base, repeat: future }).repeat).toEqual(future);
		expect(taskSchema.safeParse({ ...base, repeat: { type: "days", every: 0 } }).success).toBe(
			false,
		);
		expect(taskSchema.parse({ ...base, repeat: { type: "weeks", days: [1] } }).repeat).toEqual({
			type: "weeks",
			every: 1,
			days: [1],
			weekStart: 1,
			until: null,
			count: null,
			endedAt: null,
		});
		expect(taskSchema.safeParse({ ...base, law: 5 }).success).toBe(false);
	});

	test("tracker entries: known types validated with defaults, unknown types untouched", () => {
		const base = {
			id: "e",
			createdAt: 1,
			updatedAt: 1,
			habitId: "h",
			date: "2026-10-10",
		};
		const unknown = { ...base, type: "mood", data: { level: 9, anything: [1, 2] } };
		expect(trackerEntrySchema.parse(unknown)).toEqual({
			...unknown,
			at: null,
			deletedAt: null,
		});
		const expense = trackerEntrySchema.parse({
			...base,
			type: "expense",
			data: { amount: 500, currency: "BRL", extra: "kept" },
		});
		expect(expense.data).toEqual({
			amount: 500,
			currency: "BRL",
			category: "other",
			note: null,
			photos: [],
			extra: "kept",
		});
		const bad = trackerEntrySchema.safeParse({ ...base, type: "expense", data: { amount: 0 } });
		expect(bad.success).toBe(false);
		if (!bad.success) expect(bad.error.issues[0]?.path[0]).toBe("data");
		// Prototype keys are not entry types.
		expect(trackerEntrySchema.safeParse({ ...base, type: "constructor", data: {} }).success).toBe(
			true,
		);
	});

	test("photo entries need a photo or a caption; slips use the shared cue taxonomy", () => {
		const photo = ENTRY_DATA.photo;
		expect(photo.safeParse({ photos: [], caption: "  " }).success).toBe(false);
		expect(photo.safeParse({ caption: "Rice and beans" }).success).toBe(true);
		expect(photo.safeParse({ photos: new Array(5).fill(ENTRY_SAMPLES.expense) }).success).toBe(
			false,
		);
		for (const cue of CUE_TYPES) expect(ENTRY_DATA.slip.safeParse({ cue }).success).toBe(true);
		expect(ENTRY_DATA.slip.safeParse({ cue: "place" }).success).toBe(false);
	});

	test("asTyped and deterministic ids", () => {
		const sample = ENTRY_SAMPLES.wake as Parameters<typeof asTyped>[0];
		const typed = asTyped(sample);
		expect(typed?.type).toBe("wake");
		if (typed?.type === "wake") expect(typed.data.deadline).toBe(400);
		expect(asTyped({ ...sample, type: "mood" })).toBeNull();
		expect(asTyped({ ...sample, data: {} })).toBeNull();
		expect(trackerEntryKeyId("h", "wake", "2026-10-10")).toBe("h:wake:2026-10-10");
		expect(taskLogId("t", "2026-10-10")).toBe("t:2026-10-10");
		expect(translationId("habits", "h", "pt-BR")).toBe("habits:h:pt-BR");
		const longest = translationId("trackerEntries", "x".repeat(36), "pt-BR");
		expect(longest.length).toBeLessThanOrEqual(80);
	});

	test("journal kinds are open; answers are a bounded string map", () => {
		const base = { id: "j", createdAt: 1, updatedAt: 1, date: "2026-10-10" };
		expect(journalEntrySchema.parse({ ...base, kind: "gratitude" }).kind).toBe("gratitude");
		const answers = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`a${i}`, "x"]));
		expect(journalEntrySchema.safeParse({ ...base, kind: "note", answers }).success).toBe(false);
		const long = { a: "x".repeat(8_000), b: "x".repeat(8_000), c: "x".repeat(5_000) };
		expect(journalEntrySchema.safeParse({ ...base, kind: "note", answers: long }).success).toBe(
			false,
		);
		expect(journalEntrySchema.safeParse({ ...base, kind: "note", answers: { a: 1 } }).success).toBe(
			false,
		);
		// Annex J §8: ids are prompt ids; one a newer build would use (camelCase) is kept.
		const bad = { ...base, kind: "note", answers: { "Bad-Id": "x" } };
		expect(journalEntrySchema.safeParse(bad).success).toBe(false);
		const future = journalEntrySchema.parse({
			...base,
			kind: "note",
			answers: { laterPrompt: "x" },
		});
		expect(future.answers).toEqual({ laterPrompt: "x" });
		expect(
			journalEntrySchema.safeParse({
				...base,
				kind: "review",
				range: { from: "2026-10-10", to: "2026-10-01" },
			}).success,
		).toBe(false);
	});

	test("attachment refs and primitives", () => {
		expect(ATTACHMENT_MIMES).toEqual(["image/jpeg", "image/webp"]);
		expect(
			attachmentRefSchema.safeParse({
				hash: "A".repeat(64),
				thumb: "b".repeat(64),
				mime: "image/jpeg",
				w: 1,
				h: 1,
				bytes: 1,
			}).success,
		).toBe(false);
		expect(monthKeySchema.safeParse("2026-10").success).toBe(true);
		expect(monthKeySchema.safeParse("2026-13").success).toBe(false);
		expect(weekdaySchema.safeParse(7).success).toBe(false);
		expect(monthKeyOf("2026-10-17")).toBe("2026-10");
		expect(daysInMonth("2028-02")).toBe(29);
		expect(daysInMonth("2026-02-10")).toBe(28);
	});

	test("hasAnyData looks at live user documents only", () => {
		const data = emptyData();
		expect(hasAnyData(data)).toBe(false);
		data.logs["h:2026-10-10"] = maximalDocuments().logs[0] as never;
		expect(hasAnyData(data)).toBe(false);
		const entry = journalEntrySchema.parse(maximalDocuments().journal[0]);
		data.journal.j = { ...entry, deletedAt: 5 };
		expect(hasAnyData(data)).toBe(false);
		data.journal.j = entry;
		expect(hasAnyData(data)).toBe(true);
	});
});

describe("upgradeRecord", () => {
	test("legacy habits without emojiAuto become auto when their icon is the v1 default", () => {
		expect(LEGACY_DEFAULT_EMOJI).toBe("✨");
		expect(upgradeRecord("habits", { id: "h", emoji: "✨" }).emojiAuto).toBe(true);
		expect(upgradeRecord("habits", { id: "h" }).emojiAuto).toBe(true);
		expect(upgradeRecord("habits", { id: "h", emoji: "📖" }).emojiAuto).toBe(false);
	});

	test("records that need nothing are returned as-is", () => {
		const auto = { id: "h", emoji: "✨", emojiAuto: false };
		expect(upgradeRecord("habits", auto)).toBe(auto);
		const task = { id: "t", emoji: "✨" };
		expect(upgradeRecord("tasks", task)).toBe(task);
		expect(upgradeRecord("futureThings", task)).toBe(task);
	});

	test("upgraded legacy habits parse", () => {
		const raw = { id: "h", name: "Run", createdAt: 1, updatedAt: 1, startDate: "2026-01-01" };
		const parsed = habitSchema.parse(upgradeRecord("habits", raw));
		expect(parsed.emojiAuto).toBe(true);
	});
});

describe("module graph", () => {
	test("no runtime import cycles in src (no TDZ at module evaluation)", () => {
		expect(runtimeCycles(sourceFiles())).toEqual([]);
	});

	test("schema modules evaluate first in a fresh process", () => {
		const entries = [
			"primitives.ts",
			"attachments.ts",
			"trackers/schema.ts",
			"model.ts",
			"upgrade.ts",
			"sync.ts",
			"trackers/index.ts",
			"actions/cloud.ts",
			"trackers/actions.ts",
			"sync-engine.ts",
			"store.ts",
			"index.ts",
		];
		for (const entry of entries) {
			const run = Bun.spawnSync({
				cmd: [process.execPath, "-e", `await import(${JSON.stringify(srcPath(entry))})`],
				cwd: SRC,
				stderr: "pipe",
				stdout: "pipe",
			});
			if (run.exitCode !== 0) {
				throw new Error(`${entry} failed to load first:\n${run.stderr.toString()}`);
			}
		}
	});
});

describe("__future through the store (§8.1 acceptance)", () => {
	type Records = Record<string, Record<string, unknown>>;
	const injected = () => withFuture(maximalDocuments());
	const newStore = (at = 1_790_000_000_000) => {
		const store = createAtomicStore({
			storage: createMemoryStorage(),
			debounceMs: 0,
			now: () => at,
		});
		store.getState().actions.setTracking(true);
		return store;
	};
	const recordsOf = (store: AtomicStore, collection: (typeof COLLECTIONS)[number]) =>
		store.getState().data[collection] as unknown as Records;
	const pull = (store: AtomicStore, docs: ReturnType<typeof injected>) =>
		store.getState().actions.applyRemote(
			COLLECTIONS.flatMap((collection) =>
				docs[collection].map((doc) => ({
					collection,
					id: doc.id as string,
					updatedAt: doc.updatedAt as number,
					deletedAt: null,
					data: doc,
				})),
			),
			{ reconcile: false },
		);
	/** Every injected `__future` path is still there (auto icons may change `emoji`). */
	const expectFuture = (store: AtomicStore, docs: ReturnType<typeof injected>, what: string) => {
		for (const collection of COLLECTIONS) {
			for (const doc of docs[collection]) {
				const stored = recordsOf(store, collection)[doc.id as string];
				expect({ what, collection, id: doc.id, paths: futurePaths(stored) }).toEqual({
					what,
					collection,
					id: doc.id,
					paths: futurePaths(doc),
				});
			}
		}
	};

	test("applyRemote keeps every level", () => {
		const docs = injected();
		const store = newStore();
		const total = COLLECTIONS.reduce((n, c) => n + docs[c].length, 0);
		expect(pull(store, docs).applied).toBe(total);
		expectFuture(store, docs, "applyRemote");
		expect(store.getState().sync.superseded).toEqual({});
	});

	test("validated() write paths (v1 actions) keep every level", () => {
		const docs = injected();
		const store = newStore();
		pull(store, docs);
		const { actions } = store.getState();
		for (const doc of docs.tasks) actions.updateTask(doc.id as string, { title: "Edited" });
		for (const doc of docs.habits) actions.updateHabit(doc.id as string, { name: "Edited" });
		for (const doc of docs.identities)
			actions.updateIdentity(doc.id as string, { statement: "Edited" });
		for (const doc of docs.scorecard)
			actions.updateScorecardItem(doc.id as string, { label: "Edited" });
		for (const doc of docs.logs)
			actions.setNote(doc.habitId as string, doc.date as string, "Edited");
		for (const collection of ["tasks", "habits", "identities", "scorecard", "logs"] as const) {
			for (const doc of docs[collection]) {
				const stored = recordsOf(store, collection)[doc.id as string];
				expect(stored?.updatedAt).toBeGreaterThan(doc.updatedAt as number);
			}
		}
		expectFuture(store, docs, "validated");
	});

	test("validated() write paths (v2 collections) keep every level", () => {
		const flags = { ...FEATURES };
		Object.assign(FEATURES, { templateTrackers: true, trackerPhaseB: true, trackerPhotos: true });
		try {
			const docs = injected();
			// Every habit live and unarchived, so its tracker accepts entries.
			for (const habit of docs.habits) habit.archivedAt = null;
			// Each sample entry on the habit whose tracker logs its type (keyed ids re-keyed).
			const owner: Record<string, string> = { book: "reading", none: "expense" };
			const keyed = new Set(["none", "wake", "sleep", "plan"]);
			for (const entry of docs.trackerEntries) {
				const type = entry.type as string;
				if (!(type in ENTRY_SAMPLES)) continue; // a future type stays read-only
				entry.habitId = `habit-${owner[type] ?? type}`;
				if (keyed.has(type)) {
					entry.id = trackerEntryKeyId(
						entry.habitId as string,
						type as never,
						entry.date as string,
					);
				}
			}
			// The task log on an occurrence of a live, open series.
			const series = docs.tasks.find((t) => t.id === "task-days") as Record<string, unknown>;
			series.completedAt = null;
			(series.repeat as Record<string, unknown>).endedAt = null;
			const [log] = docs.taskLogs as Record<string, unknown>[];
			Object.assign(log as object, {
				id: taskLogId("task-days", "2026-10-07"),
				taskId: "task-days",
				date: "2026-10-07",
			});

			const store = newStore(new Date(2026, 9, 20, 12).getTime());
			pull(store, docs);
			const { actions } = store.getState();
			const rewritten: [(typeof COLLECTIONS)[number], string][] = [];

			// Journal: a signed contract (pinned only), then its terms once revoked.
			actions.updateJournalEntry("journal-1", { pinned: false });
			actions.revokeContractSignature("journal-1");
			actions.updateJournalEntry("journal-1", {
				contract: { partner: "Bia" } as never,
				date: "2026-10-03",
			});
			actions.updateJournalEntry("journal-future-kind", { pinned: true });
			expect(recordsOf(store, "journal")["journal-1"]?.contract).toMatchObject({ partner: "Bia" });
			rewritten.push(["journal", "journal-1"], ["journal", "journal-future-kind"]);

			// Task logs: settle, undo, settle again (revives the same document).
			expect(actions.completeOccurrence("task-days", "2026-10-07")).not.toBeNull();
			actions.reopenOccurrence("task-days", "2026-10-07");
			expect(actions.completeOccurrence("task-days", "2026-10-07")?.status).toBe("done");
			rewritten.push(["taskLogs", log?.id as string]);

			// Tracker entries: every known type edited; the plan re-saved; one deleted and restored.
			for (const entry of docs.trackerEntries) {
				const type = entry.type as string;
				if (!(type in ENTRY_SAMPLES)) continue;
				const id = entry.id as string;
				const edited =
					type === "plan"
						? actions.savePlan(entry.habitId as string, entry.date as string, {
								items: ["Draft the report", "Call Ana", "Book the dentist"],
							})
						: actions.updateTrackerEntry(id, { data: {} });
				expect({ type, edited: edited?.id }).toEqual({ type, edited: id });
				rewritten.push(["trackerEntries", id]);
			}
			const planId = trackerEntryKeyId("habit-plan", "plan", "2026-10-10");
			expect(actions.updateTrackerEntry(planId, { data: { reflection: "ok" } })?.id).toBe(planId);
			actions.deleteTrackerEntry("entry-workout");
			actions.restoreTrackerEntry("entry-workout");
			expect(recordsOf(store, "trackerEntries")["entry-workout"]?.deletedAt).toBeNull();

			// Translations: a new field next to the existing ones.
			const [translation] = docs.translations as Record<string, unknown>[];
			const written = actions.applyTranslations([
				{
					collection: "habits",
					id: "habit-plain",
					field: "reward",
					src: "0a1b2c3d",
					locale: "pt-BR",
					text: "Marcar o calendário",
				},
			]);
			expect(written).toBe(1);
			rewritten.push(["translations", translation?.id as string]);

			for (const [collection, id] of rewritten) {
				const doc = docs[collection].find((d) => d.id === id);
				const stored = recordsOf(store, collection)[id];
				const newer = ((stored?.updatedAt as number) ?? 0) > (doc?.updatedAt as number);
				expect({ collection, id, newer }).toEqual({
					collection,
					id,
					newer: true,
				});
			}
			expectFuture(store, docs, "validated v2");
			const plan = recordsOf(store, "trackerEntries")[planId]?.data as Record<string, unknown>;
			expect((plan.items as unknown[]).length).toBe(3);
		} finally {
			Object.assign(FEATURES, flags);
		}
	});

	test("export → import (merge and replace) keeps every level", () => {
		const docs = injected();
		const source = newStore();
		pull(source, docs);
		const file = JSON.parse(JSON.stringify(source.getState().actions.exportData()));
		for (const mode of ["merge", "replace"] as const) {
			const target = newStore();
			const result = target.getState().actions.importData(file, mode);
			expect(result.skipped).toBe(0);
			expectFuture(target, docs, mode);
		}
	});
});
