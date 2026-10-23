import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { type AtomicData, COLLECTIONS, type Collection, SCHEMA_REV, emptyData } from "../src/model";
import { emptySync, hydratePersisted, logNormalization } from "../src/persist-layout";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore, deriveAutoEmojis } from "../src/store";
import {
	NAME,
	T0,
	bigDataSet,
	dump,
	entity,
	hydrated,
	parse,
	recordingKv,
	storeOn,
	v1Habit,
	v1Log,
	v1MainKey,
	writeLayout,
} from "./support/persistence";
import { futurePaths, maximalDocuments, withFuture } from "./support/v2-documents";

/**
 * Hydration (spec §2.6.4 merge rules 1–7, §2.3 legacy icons, §2.6.6
 * performance) and Annex H's hydration-normalization case.
 */

const META = `${NAME}:meta`;
const spies: { mockRestore(): void }[] = [];
afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
});
const quiet = () => {
	spies.push(spyOn(console, "info").mockImplementation(() => {}));
};

const byId = (records: Record<string, unknown>[]) =>
	Object.fromEntries(records.map((r) => [r.id as string, r]));

const v1Task = {
	...entity("t1"),
	title: "Put the book on the pillow",
	notes: null,
	date: "2026-10-17",
	priority: 1,
	completedAt: null,
	identityId: null,
	order: 0,
};
const v1Identity = {
	...entity("i1"),
	statement: "I am a reader",
	emoji: "📚",
	color: "indigo",
	order: 0,
};
const v1Score = {
	...entity("s1"),
	label: "Coffee",
	rating: "neutral",
	time: null,
	order: 0,
};

describe("rule 2: normalization on a schema revision change", () => {
	test("v1 records gain the v2 defaults, keep unknown fields, and invalid ones stay raw", async () => {
		quiet();
		const corrupt = v1Habit("bad", { name: "" });
		const log: Record<string, unknown> = v1Log("h1", "2026-10-10");
		// biome-ignore lint/performance/noDelete: a v1 log missing a field
		delete log.note;
		const kv = recordingKv({
			[NAME]: v1MainKey({
				habits: {
					h1: v1Habit("h1", {
						legacyField: "keep",
						schedule: { type: "weekly", times: 3, future: 1 },
					}),
					bad: corrupt,
				},
				logs: { [log.id as string]: log },
				tasks: { t1: v1Task },
				identities: { i1: v1Identity },
				scorecard: { s1: v1Score },
			}),
		});
		const store = storeOn(kv);
		const { data } = store.getState();
		expect(data.habits.h1).toMatchObject({
			emojiAuto: false,
			goalHistory: [],
			levelUp: null,
			tracker: null,
			lang: null,
			legacyField: "keep",
		});
		expect(data.habits.h1?.schedule).toEqual({ type: "weekly", times: 3, future: 1 } as never);
		expect(data.habits.bad).toEqual(corrupt as never);
		// Logs are never normalized (§2.6.4): copied as stored.
		expect(data.logs[log.id as string]).toEqual(log as never);
		expect(data.tasks.t1).toMatchObject({
			repeat: null,
			time: null,
			habitId: null,
			law: null,
			habitField: null,
			sourceEntryId: null,
			lang: null,
		});
		expect(data.identities.i1?.lang).toBeNull();
		expect(data.scorecard.s1?.lang).toBeNull();
		await store.flush();
		expect(parse(kv.raw(META)).dataRev).toBe(SCHEMA_REV);
	});

	test("records are copied raw while dataRev is current; a revision change rewrites the normalized slices once", async () => {
		quiet();
		const journal = { ...entity("j1"), kind: "evidence", date: "2026-10-01" }; // no answers, pinned…
		const taskLog = {
			...entity("t1:2026-10-02"),
			taskId: "t1",
			date: "2026-10-02",
			resolvedOn: "2026-10-02",
		};
		const trackerEntry = {
			...entity("e1"),
			habitId: "h1",
			date: "2026-10-03",
			type: "expense",
			data: { amount: 1250, currency: "BRL", category: "food", note: null },
		};
		const data = {
			...emptyData(),
			habits: {
				h1: {
					...v1Habit("h1"),
					emojiAuto: false,
					goalHistory: [],
					levelUp: null,
					tracker: null,
					lang: null,
				},
			},
			logs: { "h1:2026-10-03": v1Log("h1", "2026-10-03") },
			journal: { j1: journal },
			taskLogs: { [taskLog.id]: taskLog },
			trackerEntries: { e1: trackerEntry },
		} as unknown as AtomicData;
		const kv = recordingKv();
		await writeLayout(kv, { data, dataRev: SCHEMA_REV });

		// Raw path: nothing is filled in.
		const rawStore = storeOn(kv);
		const raw = rawStore.getState().data;
		expect(raw.journal.j1).toEqual(journal as never);
		expect(raw.taskLogs[taskLog.id]).toEqual(taskLog as never);
		expect(raw.trackerEntries.e1).toEqual(trackerEntry as never);

		// Its own write (the settings defaults) lands before the edit below.
		await rawStore.flush();

		// A revision change: every collection but logs is normalized.
		const meta = parse(kv.raw(META));
		await kv.setItem(META, JSON.stringify({ ...meta, dataRev: 1 }));
		kv.reset();
		const upgraded = storeOn(kv);
		const after = upgraded.getState().data;
		expect(after.journal.j1).toMatchObject({ answers: {}, pinned: false, contract: null });
		expect(after.taskLogs[taskLog.id]).toMatchObject({ status: "done" });
		expect(after.trackerEntries.e1).toMatchObject({ at: null });
		await upgraded.flush();
		// Every normalized key once; the logs slice is untouched.
		expect(kv.writes.sort()).toEqual(
			[
				NAME,
				META,
				`${NAME}:c:journal`,
				`${NAME}:c:taskLogs:2026`,
				`${NAME}:c:trackerEntries:2026`,
			].sort(),
		);
		expect(parse(kv.raw(META)).dataRev).toBe(SCHEMA_REV);

		// Once: the next start copies raw and writes nothing.
		kv.reset();
		const again = storeOn(kv);
		await again.flush();
		expect(kv.writes).toEqual([]);
		expect(again.getState().data.journal.j1).toEqual(after.journal.j1);
	});

	test("the normalization path logs one timing line; a slow one is a warning (§2.6.6)", () => {
		const info = spyOn(console, "info").mockImplementation(() => {});
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		spies.push(info, warn);
		storeOn(recordingKv({ [NAME]: v1MainKey({ habits: { h1: v1Habit("h1") } }) }));
		expect(info).toHaveBeenCalledTimes(1);
		expect(String(info.mock.calls[0]?.[0])).toMatch(
			new RegExp(`^\\[atomic\\] Normalized 1 records to schema rev ${SCHEMA_REV} in [\\d.]+ ms$`),
		);
		// The raw path logs nothing.
		info.mockClear();
		storeOn(createMemoryStorage());
		expect(info).not.toHaveBeenCalled();
		const result = hydratePersisted({ data: {} });
		logNormalization({ ...result, normalized: { records: 36_000, ms: 9_000 } });
		expect(String(warn.mock.calls.at(-1)?.[0])).toMatch(/Normalized 36000 records .* \(slow\)$/);
	});
});

describe("rules 1 and 3: known and unknown collections", () => {
	test("unknown collections inside the main key go to foreign and are written back unchanged", async () => {
		quiet();
		const future = { x1: { id: "x1", updatedAt: T0, payload: { deep: [1, 2] } } };
		const unknownSlice = JSON.stringify({ y1: { id: "y1" } });
		const kv = recordingKv({
			[NAME]: v1MainKey({ habits: { h1: v1Habit("h1") }, futureThings: future }),
			[`${NAME}:c:moreThings`]: unknownSlice,
		});
		const store = storeOn(kv);
		expect(store.getState().foreign).toEqual({ futureThings: future });
		expect(Object.keys(store.getState().data)).toEqual([...COLLECTIONS]);
		store.getState().actions.createHabit({ name: "Read" });
		await store.flush();
		expect(parse(kv.raw(META)).foreign).toEqual({ futureThings: future });
		// Unknown slice keys are never read into state and never rewritten.
		expect(kv.raw(`${NAME}:c:moreThings`)).toBe(unknownSlice);
		expect(kv.writes).not.toContain(`${NAME}:c:moreThings`);
		// …and survive the next start.
		expect(storeOn(kv).getState().foreign).toEqual({ futureThings: future });
	});

	test("records come from the main key, the slices and foreign[c], merged by last write", async () => {
		quiet();
		const older = {
			...entity("j1", T0),
			kind: "note",
			date: "2026-10-01",
			answers: { text: "old" },
		};
		const newer = { ...older, updatedAt: T0 + 5, answers: { text: "new" } };
		const kv = recordingKv();
		await writeLayout(kv, {
			data: { ...emptyData(), journal: { j1: older } } as unknown as AtomicData,
			// A build that didn't know `journal` kept it in foreign.
			foreign: { journal: { j1: newer, j2: { ...older, id: "j2" } } },
			dataRev: SCHEMA_REV,
		});
		const state = storeOn(kv).getState();
		expect((state.data.journal.j1 as unknown as typeof newer).answers.text).toBe("new");
		expect(state.data.journal.j2).toBeDefined();
		expect(state.foreign).toEqual({});
	});
});

describe("rule 4: sync meta", () => {
	test("a v1 sync meta re-pulls once (schemaRev 1) and keeps tracking (and pending keys) when the device synced", () => {
		quiet();
		const pending = { "habits/h1": true, "logs/h1:2026-10-10": true } as const;
		const synced = storeOn(
			recordingKv({
				[NAME]: v1MainKey(
					{ habits: { h1: v1Habit("h1") } },
					{ cursor: 830, pending, lastSyncedAt: T0 },
				),
			}),
		).getState().sync;
		expect(synced).toEqual({
			...emptySync(),
			cursor: 830,
			pending,
			lastSyncedAt: T0,
			schemaRev: 1,
			tracking: true,
		});

		// Never synced: v1 recorded a pending key for every write; sign-in marks
		// everything pending anyway (D57), so they are dropped.
		const local = storeOn(
			recordingKv({ [NAME]: v1MainKey({}, { cursor: 0, pending, lastSyncedAt: null }) }),
		).getState().sync;
		expect(local.tracking).toBe(false);
		expect(local.pending).toEqual({});
		expect(local.schemaRev).toBe(1);

		// Never synced but has a lastSyncedAt? Still a synced device.
		expect(
			storeOn(
				recordingKv({ [NAME]: v1MainKey({}, { cursor: 0, pending: {}, lastSyncedAt: T0 }) }),
			).getState().sync.tracking,
		).toBe(true);
	});

	test("v2 sync meta is kept as stored; a fresh install starts at SCHEMA_REV, not tracking", async () => {
		quiet();
		expect(storeOn(createMemoryStorage()).getState().sync).toEqual(emptySync());
		expect(emptySync().schemaRev).toBe(SCHEMA_REV);

		const kv = recordingKv();
		const sync = {
			...emptySync(),
			cursor: 12,
			lastSyncedAt: T0,
			tracking: false,
			clockOffsetMs: 180_000,
		};
		await writeLayout(kv, { data: emptyData(), sync, dataRev: SCHEMA_REV });
		expect(storeOn(kv).getState().sync).toEqual(sync);
	});

	test("damaged sync fields fall back to their defaults; unknown ones are kept", async () => {
		quiet();
		const kv = recordingKv({
			[NAME]: v1MainKey({}, { cursor: "x", pending: null, lastSyncedAt: T0, futureField: 3 }),
		});
		const sync = storeOn(kv).getState().sync as unknown as Record<string, unknown>;
		expect(sync.cursor).toBe(0);
		expect(sync.pending).toEqual({});
		expect(sync.futureField).toBe(3);
	});
});

describe("rule 5: settings", () => {
	test("settings merge over the defaults as in v1; invalid settings fall back to the defaults", () => {
		quiet();
		const ok = storeOn(
			recordingKv({ [NAME]: v1MainKey({}, null, { displayName: "Ana", locale: "pt-BR" }) }),
		);
		expect(ok.getState().settings).toMatchObject({
			displayName: "Ana",
			locale: "pt-BR",
			syncJournal: true,
		});
		const bad = storeOn(recordingKv({ [NAME]: v1MainKey({}, null, { locale: "klingon" }) }));
		expect(bad.getState().settings.locale).toBe("system");
	});
});

describe("rule 6: derived auto icons (§2.3, D12)", () => {
	test("legacy ✨ habits derive the auto emoji without stamping or marking pending", async () => {
		quiet();
		const identity = { ...v1Identity, emoji: "📚" };
		const deletedIdentity = { ...v1Identity, id: "i2", emoji: "🧘", deletedAt: T0 };
		const habits = {
			reader: v1Habit("reader", { emoji: "✨", identityId: "i1" }),
			slip: v1Habit("slip", { emoji: "✨", kind: "break" }),
			bare: (() => {
				const h = v1Habit("bare");
				// biome-ignore lint/performance/noDelete: a v1 habit without an emoji
				delete h.emoji;
				return h;
			})(),
			orphan: v1Habit("orphan", { emoji: "✨", identityId: "i2" }),
			custom: v1Habit("custom", { emoji: "🎸", identityId: "i1" }),
		};
		const kv = recordingKv({
			[NAME]: v1MainKey({ habits, identities: { i1: identity, i2: deletedIdentity } }),
		});
		const store = storeOn(kv);
		const h = store.getState().data.habits;
		expect([
			h.reader?.emoji,
			h.slip?.emoji,
			h.bare?.emoji,
			h.orphan?.emoji,
			h.custom?.emoji,
		]).toEqual(["📚", "🚫", "🌱", "🌱", "🎸"]);
		expect([h.reader?.emojiAuto, h.custom?.emojiAuto]).toEqual([true, false]);
		for (const habit of Object.values(h)) expect(habit.updatedAt).toBe(T0);
		expect(store.getState().sync.pending).toEqual({});

		// Stored locally as derived; the next start derives nothing new.
		await store.flush();
		kv.reset();
		const again = storeOn(kv);
		await again.flush();
		expect(again.getState().data.habits.reader?.emoji).toBe("📚");
		expect(kv.writes).toEqual([]);
	});

	test("applyRemote upgrades v1 documents and derives their icon (not stamped, not pending)", () => {
		const store = storeOn(createMemoryStorage());
		const { actions } = store.getState();
		const identity = actions.createIdentity({ statement: "I am present", emoji: "🫶" });
		actions.setSyncMeta({ pending: {} });
		const remote = v1Habit("r1", { emoji: "✨", identityId: identity.id, updatedAt: T0 + 7 });
		expect(
			actions.applyRemote([
				{ collection: "habits", id: "r1", updatedAt: T0 + 7, deletedAt: null, data: remote },
			]).applied,
		).toBe(1);
		const habit = store.getState().data.habits.r1;
		expect(habit).toMatchObject({ emoji: "🫶", emojiAuto: true, updatedAt: T0 + 7 });
		expect(store.getState().sync.pending).toEqual({});
	});

	test("a raw identity with a non-string emoji never breaks hydration or wipes the disk", async () => {
		quiet();
		spies.push(spyOn(console, "warn").mockImplementation(() => {}));
		const logs: Record<string, unknown> = {};
		for (let d = 1; d <= 20; d++) {
			const log = v1Log("h1", `2026-05-${String(d).padStart(2, "0")}`);
			logs[log.id as string] = log;
		}
		const kv = recordingKv({
			[NAME]: v1MainKey({
				habits: {
					h1: v1Habit("h1", { emoji: "✨", identityId: "i1" }),
					h2: v1Habit("h2", { name: "Run" }),
				},
				// Invalid (emoji must be a string): kept raw by normalization (rule 2).
				identities: { i1: { ...v1Identity, emoji: 5 } },
				logs,
			}),
		});
		const store = storeOn(kv);
		expect(store.getState().hydrated).toBe(true);
		expect(store.getState().persistError).toBeNull();
		expect(store.getState().data.habits.h1?.emoji).toBe("🌱"); // the identity gives no icon
		await store.flush();
		const disk = await dump(kv);
		expect(Object.keys(parse(disk[NAME] ?? null).state as object)).toContain("data");
		const main = parse(disk[NAME] ?? null) as { state: { data: { habits: object } } };
		expect(Object.keys(main.state.data.habits).sort()).toEqual(["h1", "h2"]);
		expect(Object.keys(parse(disk[`${NAME}:c:logs:2026`] ?? null))).toHaveLength(20);
		// A pulled habit linked to that identity: applyRemote derives its icon without throwing.
		const pulled = v1Habit("h3", { emoji: "✨", identityId: "i1", updatedAt: T0 + 5 });
		const applied = store
			.getState()
			.actions.applyRemote([
				{ collection: "habits", id: "h3", updatedAt: T0 + 5, deletedAt: null, data: pulled },
			]);
		expect(applied.applied).toBe(1);
		expect(store.getState().data.habits.h3?.emoji).toBe("🌱");
		for (const odd of [[], {}, true, -1, null]) {
			const data = emptyData();
			data.identities.i1 = { ...v1Identity, emoji: odd } as never;
			data.habits.h1 = { ...v1Habit("h1", { identityId: "i1" }), emojiAuto: true } as never;
			expect(deriveAutoEmojis(data).habits.h1?.emoji).toBe("🌱");
		}
	});

	test("when hydration throws anyway, nothing is written and the error is shown", async () => {
		quiet();
		spies.push(spyOn(console, "error").mockImplementation(() => {}));
		spies.push(spyOn(console, "warn").mockImplementation(() => {}));
		const original = v1MainKey({
			habits: { h1: v1Habit("h1"), h2: v1Habit("h2") },
			logs: { [v1Log("h1", "2026-05-01").id as string]: v1Log("h1", "2026-05-01") },
		});
		const kv = recordingKv({ [NAME]: original });
		// The normalization log line runs inside `merge`: make it throw.
		spies.push(
			spyOn(console, "info").mockImplementation(() => {
				throw new Error("merge failed");
			}),
		);
		const notices: string[] = [];
		const store = storeOn(kv);
		store.subscribeNotices((notice) => notices.push(notice.type));
		await hydrated(store);
		expect(store.getState().persistError?.message).toContain("merge failed");
		expect(notices).toEqual(["persist-error"]);
		// Edits stay in memory; the disk keeps the user's data.
		store.getState().actions.createHabit({ name: "New" });
		await store.flush();
		expect(kv.writes).toEqual([]);
		expect(kv.raw(NAME)).toBe(original);
	});

	test("deriveAutoEmojis returns the same object when nothing changes", () => {
		const data = emptyData();
		expect(deriveAutoEmojis(data)).toBe(data);
	});
});

describe("forward compatibility", () => {
	const futureData = () => {
		const docs = withFuture(maximalDocuments());
		const data = emptyData() as unknown as Record<Collection, Record<string, unknown>>;
		for (const collection of COLLECTIONS) data[collection] = byId(docs[collection]);
		return data as unknown as AtomicData;
	};

	for (const dataRev of [1, SCHEMA_REV]) {
		test(`__future at every object level survives hydration (dataRev ${dataRev})`, async () => {
			quiet();
			const data = futureData();
			const kv = recordingKv();
			await writeLayout(kv, { data, dataRev });
			const hydratedData = storeOn(kv).getState().data;
			for (const collection of COLLECTIONS) {
				const records = (data as unknown as Record<Collection, Record<string, unknown>>)[
					collection
				];
				expect(Object.keys(records).length).toBeGreaterThan(0);
				for (const [id, record] of Object.entries(records)) {
					const after = (hydratedData as unknown as Record<Collection, Record<string, unknown>>)[
						collection
					][id];
					expect({ collection, id, paths: futurePaths(after) }).toEqual({
						collection,
						id,
						paths: futurePaths(record),
					});
				}
			}
		});
	}
});

describe("performance (§2.6.6)", () => {
	test("raw hydration of 15k logs, 10k task logs, 10k tracker entries and 1k journal entries takes < 50 ms", async () => {
		const kv = createMemoryStorage();
		await writeLayout(kv, { data: bigDataSet(), dataRev: SCHEMA_REV });
		let best = Number.POSITIVE_INFINITY;
		for (let run = 0; run < 3; run++) {
			const started = performance.now();
			const store = createAtomicStore({ storage: kv, debounceMs: 0 });
			const elapsed = performance.now() - started;
			expect(store.getState().hydrated).toBe(true);
			expect(Object.keys(store.getState().data.logs)).toHaveLength(15_000);
			expect(Object.keys(store.getState().data.taskLogs)).toHaveLength(10_000);
			expect(Object.keys(store.getState().data.trackerEntries)).toHaveLength(10_000);
			expect(Object.keys(store.getState().data.journal)).toHaveLength(1_000);
			await store.flush();
			best = Math.min(best, elapsed);
		}
		console.info(`[atomic] raw hydration of the §2.6.6 data set: ${best.toFixed(1)} ms`);
		expect(best).toBeLessThan(50);
	});
});

describe("rule 7: resetAll and clearLocalData", () => {
	const seeded = async () => {
		quiet();
		const kv = recordingKv({ [`${NAME}:c:futureThings`]: "{}" });
		const store = storeOn(kv);
		const { actions } = store.getState();
		const habit = actions.createHabit({ name: "Read" });
		actions.setCount(habit.id, "2025-12-31", 1);
		actions.setCount(habit.id, "2026-01-01", 1);
		actions.updateSettings({ displayName: "Ana" });
		store.setState({ foreign: { futureThings: { x: { id: "x" } } } });
		await store.flush();
		expect(Object.keys(await dump(kv))).toContain(`${NAME}:c:logs:2025`);
		return { kv, store };
	};

	test("resetAll wipes every key, slices and unknown slices included", async () => {
		const { kv, store } = await seeded();
		store.getState().actions.resetAll();
		await store.flush();
		// Defaults need no keys: nothing is left.
		expect(await dump(kv)).toEqual({});
		const reloaded = storeOn(kv).getState();
		expect(reloaded.settings.displayName).toBe("");
		expect(Object.keys(reloaded.data.habits)).toHaveLength(0);
		expect(reloaded.foreign).toEqual({});
	});

	test("clearLocalData wipes data, sync, foreign and slices without tombstones, and keeps settings", async () => {
		const { kv, store } = await seeded();
		store.getState().actions.setSyncMeta({ cursor: 40, lastSyncedAt: T0 });
		store.getState().actions.clearLocalData();
		await store.flush();
		expect(store.getState().data).toEqual(emptyData());
		expect(store.getState().sync).toEqual(emptySync());
		expect(Object.keys(await dump(kv)).sort()).toEqual([NAME, META]);
		const reloaded = storeOn(kv).getState();
		expect(reloaded.settings.displayName).toBe("Ana");
		expect(reloaded.data).toEqual(emptyData());
		expect(reloaded.sync.pending).toEqual({});
		expect(reloaded.foreign).toEqual({});
	});
});
