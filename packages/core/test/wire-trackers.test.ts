import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { toDayKey } from "../src/dates";
import { type Collection, collectionSchemas, logId } from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, createAtomicStore } from "../src/store";
import {
	MAX_RECORD_BYTES,
	type WireSyncRecord,
	serializedBytes,
	validateWireRecord,
} from "../src/sync";
import { runSync } from "../src/sync-engine";
import { isKnownTrackerType } from "../src/trackers/meta";
import {
	ENTRY_TYPES,
	type TrackerEntry,
	dropUnsafeChars,
	hasUnsafeChars,
	isEntryType,
} from "../src/trackers/schema";
import { fakeSyncServer, wire } from "./support/sync-server";
import { ENTRY_SAMPLES, TRACKER_CONFIGS, maximalDocuments } from "./support/v2-documents";

/**
 * The trackers half of the wire contract (spec §4.6, "per-collection
 * validation cases move to core tests of `validateWireRecord`"; Annex K §8
 * server `sync.test.ts` cases): entries and their logs round-trip, plan
 * tasks travel with their plan (D17), an invalid expense is refused at
 * `data.amount` while the rest of the batch is stored, unknown entry types
 * and foreign tracker configs pass verbatim, a 16 000-character writing page
 * is accepted, and the largest valid entry of every type, escapes included,
 * stays under `MAX_RECORD_BYTES`.
 */

const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const TODAY = toDayKey(NOW); // Tuesday 2026-10-20
/** The server clock for `validateWireRecord` (a minute after the devices' clock). */
const CHECKED_AT = NOW + 60_000;
const CANARY = "canary-secret-text";
/** A server whose clock is an hour after the devices' (stamps are never "in the future"). */
const makeServer = () => fakeSyncServer({ clockOffsetMs: NOW + 3_600_000 - Date.now() });

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const record = (collection: string, data: Record<string, unknown>): WireSyncRecord => ({
	collection,
	id: data.id as string,
	updatedAt: (data.updatedAt as number) ?? 2,
	deletedAt: (data.deletedAt as number | null) ?? null,
	data,
});
const check = (collection: string, data: Record<string, unknown>) =>
	validateWireRecord(record(collection, data), CHECKED_AT);

const entryDoc = (type: string, data: Record<string, unknown>, extra = {}) => ({
	id: `entry-${type}-1`,
	createdAt: 1,
	updatedAt: 2,
	deletedAt: null,
	habitId: "h1",
	date: "2026-10-19",
	type,
	at: null,
	data,
	...extra,
});

function makeStore(clock = { now: NOW }): AtomicStore {
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: () => clock.now,
		debounceMs: 0,
		deviceLocales: () => ["en"],
	});
	store.getState().actions.setTracking(true);
	return store;
}

const entriesOf = (store: AtomicStore) => store.getState().data.trackerEntries;
const live = (store: AtomicStore) =>
	Object.values(entriesOf(store))
		.filter((e) => !e.deletedAt)
		.sort((a, b) => (a.id < b.id ? -1 : 1));

describe("tracker entries on the wire", () => {
	test("entries and the logs they derive round-trip from phone to laptop unchanged", async () => {
		const server = makeServer();
		const phone = makeStore();
		const { actions } = phone.getState();
		const spend = actions.createHabit({
			name: "Log expenses",
			startDate: "2026-09-01",
			tracker: { type: "expense", currency: "BRL", budget: 120_000 },
		});
		const write = actions.createHabit({
			name: "Write",
			startDate: "2026-09-01",
			target: 300,
			tracker: { type: "writing", measure: "words" },
		});
		actions.addTrackerEntry({
			habitId: spend.id,
			date: TODAY,
			type: "expense",
			at: NOW - 3_600_000,
			data: { amount: 1250, category: "food", note: "Almoço com a Ana" },
		});
		actions.markNothingToLog(spend.id, "2026-10-19");
		actions.addTrackerEntry({
			habitId: write.id,
			date: TODAY,
			type: "writing",
			data: { text: "Morning pages — “quoted”, \\ and 😀 and 漢字.\nSecond line", title: "Day 1" },
		});
		await runSync(phone, server.transport);
		expect(Object.keys(phone.getState().sync.pending)).toEqual([]);

		const laptop = makeStore({ now: NOW + 5_000 });
		await runSync(laptop, server.transport);
		expect(live(laptop)).toEqual(live(phone));
		for (const [habit, date, count] of [
			[spend.id, TODAY, 1],
			[spend.id, "2026-10-19", 1],
			[write.id, TODAY, 8],
		] as const) {
			expect(laptop.getState().data.logs[logId(habit, date)]?.count).toBe(count);
			expect(laptop.getState().data.logs[logId(habit, date)]).toEqual(
				phone.getState().data.logs[logId(habit, date)],
			);
		}
		// Nothing left to derive on the laptop: its logs already match the entries.
		expect(laptop.getState().actions.reconcileTrackers()).toBe(0);
	});

	test("a plan travels with its tasks; deleting it on one device closes them on both (D17)", async () => {
		const server = makeServer();
		const phoneClock = { now: NOW };
		const phone = makeStore(phoneClock);
		const habit = phone.getState().actions.createHabit({
			name: "Plan tomorrow",
			startDate: "2026-09-01",
			tracker: { type: "plan", size: 3 },
		});
		const plan = phone.getState().actions.savePlan(habit.id, TODAY, {
			items: ["Send the report", "Gym at 7"],
		}) as TrackerEntry;
		expect(plan).not.toBeNull();
		const taskIds = (plan.data.items as { taskId: string }[]).map((i) => i.taskId);
		await runSync(phone, server.transport);

		const laptopClock = { now: NOW + 5_000 };
		const laptop = makeStore(laptopClock);
		await runSync(laptop, server.transport);
		for (const id of taskIds) {
			expect(laptop.getState().data.tasks[id]).toMatchObject({
				habitId: null,
				sourceEntryId: plan.id,
				date: "2026-10-21",
				completedAt: null,
				deletedAt: null,
			});
		}
		laptopClock.now += 60_000;
		laptop.getState().actions.deleteTrackerEntry(plan.id);
		await runSync(laptop, server.transport);
		phoneClock.now += 120_000;
		await runSync(phone, server.transport);
		const deletedAt = phone.getState().data.trackerEntries[plan.id]?.deletedAt;
		expect(deletedAt).toBeGreaterThan(0);
		for (const id of taskIds) expect(phone.getState().data.tasks[id]?.deletedAt).toBe(deletedAt);
		expect(phone.getState().data.logs[logId(habit.id, TODAY)]?.count).toBe(0);
	});

	test("two devices that each plan the same day offline end with one task per line (reverify K5)", async () => {
		const server = makeServer();
		const clockA = { now: NOW };
		const clockB = { now: NOW + 1_000 };
		const a = makeStore(clockA);
		const habit = a.getState().actions.createHabit({
			name: "Plan tomorrow",
			startDate: "2026-09-01",
			tracker: { type: "plan", size: 3 },
		});
		await runSync(a, server.transport);
		const b = makeStore(clockB);
		await runSync(b, server.transport);

		a.getState().actions.savePlan(habit.id, TODAY, { items: ["Gym", "Read"] });
		b.getState().actions.savePlan(habit.id, TODAY, { items: ["Gym", "Read", "Call Ana"] });
		for (let round = 0; round < 2; round++) {
			clockA.now += 1_000;
			await runSync(a, server.transport);
			clockB.now += 1_000;
			await runSync(b, server.transport);
		}
		const planId = `${habit.id}:plan:${TODAY}`;
		for (const store of [a, b]) {
			const plan = store.getState().data.trackerEntries[planId] as TrackerEntry;
			const linked = (plan.data.items as { text: string; taskId: string }[]).map((i) => i.taskId);
			const open = Object.values(store.getState().data.tasks).filter(
				(t) => !t.deletedAt && t.sourceEntryId === planId,
			);
			// Every open task of the plan is one of its lines: none is left behind.
			expect(open.map((t) => t.id).sort()).toEqual([...linked].sort());
			expect(linked).toEqual([`${planId}:0`, `${planId}:1`, `${planId}:2`]);
		}
		// A line added later takes the next free id, never a deleted task's.
		const { savePlan } = a.getState().actions;
		clockA.now += 1_000;
		savePlan(habit.id, TODAY, { items: ["Gym", "Read", "Call Ana", "Dentist"] });
		expect(a.getState().data.tasks[`${planId}:3`]).toMatchObject({ title: "Dentist" });
		clockA.now += 1_000;
		savePlan(habit.id, TODAY, { items: ["Gym", "Read"] });
		expect(a.getState().data.tasks[`${planId}:2`]?.deletedAt).not.toBeNull();
		expect(a.getState().data.tasks[`${planId}:3`]?.deletedAt).not.toBeNull();
		clockA.now += 1_000;
		savePlan(habit.id, TODAY, { items: ["Gym", "Read", "Swim"] });
		const tasks = a.getState().data.tasks;
		expect(tasks[`${planId}:4`]).toMatchObject({ title: "Swim", deletedAt: null });
		expect(tasks[`${planId}:2`]?.deletedAt).not.toBeNull();
	});

	test("an entry type from a newer client is accepted and kept verbatim, nested data too", async () => {
		const future = structuredClone(ENTRY_SAMPLES.future) as Record<string, unknown>;
		expect(check("trackerEntries", future)).toMatchObject({ ok: true });
		const server = makeServer();
		server.put(wire("trackerEntries", future));
		const laptop = makeStore();
		await runSync(laptop, server.transport);
		const kept = entriesOf(laptop)[future.id as string];
		expect(kept).toEqual(future as unknown as TrackerEntry);
		// Read-only here: it can't be edited, so the next push can't change it.
		expect(laptop.getState().actions.updateTrackerEntry(kept?.id ?? "", { data: {} })).toBeNull();
	});

	test("an invalid expense is refused at data.amount, never echoing content", () => {
		for (const amount of [0, -500, 12.5, "1250", null]) {
			const result = check(
				"trackerEntries",
				entryDoc("expense", { amount, currency: "BRL", category: "food", note: CANARY }),
			);
			expect(result.ok).toBe(false);
			if (result.ok) continue;
			expect(result.code).toBe("invalid");
			expect(result.reason.startsWith("data.amount: ")).toBe(true);
			expect(result.reason).not.toContain(CANARY);
		}
		// Other refusals carry their own path.
		const cases: [Record<string, unknown>, string][] = [
			[entryDoc("expense", { amount: 100, currency: "reais" }), "data.currency"],
			[entryDoc("wake", { minutes: 1440, deadline: 400 }), "data.minutes"],
			[entryDoc("writing", { text: "x".repeat(16_001) }), "data.text"],
			[entryDoc("writing", { text: `${CANARY}\u0007` }), "data.text"],
			[
				entryDoc("photo", { photos: [{ hash: CANARY, thumb: CANARY }], caption: null }),
				"data.photos.0",
			],
			[entryDoc("expense", { amount: 100 }, { date: "20/10/2026" }), "date"],
			[entryDoc("expense", { amount: 100 }, { habitId: "" }), "habitId"],
		];
		for (const [doc, path] of cases) {
			const result = check("trackerEntries", doc);
			expect({ path, ok: result.ok }).toEqual({ path, ok: false });
			if (result.ok) continue;
			expect(result.reason.startsWith(path)).toBe(true);
			expect(result.reason).not.toContain(CANARY);
		}
	});

	test("bad entries are refused per record while the rest of the batch is stored", async () => {
		const server = makeServer();
		const good = entryDoc("expense", { amount: 1250, currency: "BRL", category: "food" });
		const bad = entryDoc(
			"expense",
			{ amount: -1, currency: "BRL", note: CANARY },
			{ id: "entry-bad" },
		);
		const future = structuredClone(ENTRY_SAMPLES.future) as Record<string, unknown>;
		const page = entryDoc("writing", { text: "a".repeat(16_000), words: 1 }, { id: "entry-page" });
		const out = await server.transport.push({
			records: [good, bad, future, page].map((d) => wire("trackerEntries", d)),
		});
		expect(out.accepted).toBe(3);
		const rejected = out.rejected ?? [];
		expect(rejected).toHaveLength(1);
		expect(rejected[0]).toMatchObject({
			collection: "trackerEntries",
			id: "entry-bad",
			code: "invalid",
		});
		expect(rejected[0]?.reason.startsWith("data.amount: ")).toBe(true);
		expect(JSON.stringify(rejected)).not.toContain(CANARY);
		expect([...server.docs.keys()].sort()).toEqual(
			[
				`trackerEntries/${good.id}`,
				`trackerEntries/${future.id}`,
				`trackerEntries/${page.id}`,
			].sort(),
		);
	});

	test("a 16 000-character writing page is accepted, in any script", () => {
		for (const char of ["a", "中", "é", '"', "\\", "\n"]) {
			const text = char.repeat(16_000);
			const result = check("trackerEntries", entryDoc("writing", { text, words: 1 }));
			expect({ char, ok: result.ok }).toEqual({ char, ok: true });
		}
		// Surrogate pairs count two units each: 8 000 emoji fill a page.
		expect(
			check("trackerEntries", entryDoc("writing", { text: "😀".repeat(8_000), words: 0 })).ok,
		).toBe(true);
	});
});

describe("tracker configs on the wire", () => {
	test("every known config and a foreign one pass; a known type with a bad field is refused", () => {
		const docs = maximalDocuments();
		const tracked = docs.habits.filter((h) => h.tracker != null);
		const types = tracked.map((h) => (h.tracker as { type: string }).type).sort();
		const expected = Object.values(TRACKER_CONFIGS).map((c) => String(c.type));
		expect(types).toEqual(expected.sort());
		for (const habit of tracked) {
			const result = check("habits", habit);
			expect(result).toMatchObject({ ok: true });
			// Verbatim: no defaults added, unknown keys kept.
			if (result.ok) expect(result.data.tracker).toEqual(habit.tracker);
		}
		const expense = tracked.find((h) => (h.tracker as { type: string }).type === "expense");
		const bad = { ...expense, tracker: { ...(expense?.tracker as object), currency: CANARY } };
		const result = check("habits", bad as Record<string, unknown>);
		expect(result).toMatchObject({ ok: false, code: "invalid" });
		if (!result.ok) {
			expect(result.reason.startsWith("tracker")).toBe(true);
			expect(result.reason).not.toContain(CANARY);
		}
	});
});

describe("store writes stay syncable", () => {
	test("every writing page the store writes stays under MAX_RECORD_BYTES, whatever was typed", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const habit = actions.createHabit({
			name: "Write",
			startDate: "2026-09-01",
			tracker: { type: "writing", measure: "words" },
		});
		// The costliest characters per UTF-16 unit, plus what normalization drops
		// (controls, DEL, lone surrogates, carriage returns).
		const inputs = ["中", '"', "\\", "😀", "\u0001", "\u007f", "\ud800", "\r\n", "é"];
		const sizes: number[] = [];
		for (const char of inputs) {
			const text = char.repeat(16_000 / char.length);
			const entry = actions.addTrackerEntry({
				habitId: habit.id,
				date: TODAY,
				type: "writing",
				data: {
					text,
					title: char.repeat(120 / char.length),
					project: char.repeat(60 / char.length),
				},
			});
			expect({ char, stored: entry !== null }).toEqual({ char, stored: true });
			if (!entry) continue;
			expect(hasUnsafeChars(String(entry.data.text))).toBe(false);
			const bytes = serializedBytes(entry);
			sizes.push(bytes);
			expect({ char, under: bytes <= MAX_RECORD_BYTES }).toEqual({ char, under: true });
			expect(check("trackerEntries", entry as never).ok).toBe(true);
		}
		// CJK text is the worst case left, and it keeps a margin.
		expect(Math.max(...sizes)).toBeGreaterThan(45_000);
		expect(Math.max(...sizes)).toBeLessThan(MAX_RECORD_BYTES - 10_000);
	});

	test("updates are normalized the same way; dropUnsafeChars keeps pairs, tabs and newlines", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const habit = actions.createHabit({
			name: "Journal",
			startDate: "2026-09-01",
			tracker: { type: "writing", measure: "entries" },
		});
		const entry = actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "writing",
			data: { text: "short" },
		}) as TrackerEntry;
		const updated = actions.updateTrackerEntry(entry.id, {
			data: { text: "a\u0000b\r\nc\td😀\udc00e" },
		});
		expect(updated?.data.text).toBe("ab\nc\td😀e");
		expect(dropUnsafeChars("tab\there\nline 😀")).toBe("tab\there\nline 😀");
		expect(hasUnsafeChars("😀")).toBe(false);
		expect(hasUnsafeChars("\ud83d")).toBe(true);
		expect(hasUnsafeChars("x\u001f")).toBe(true);
	});
});

// ── The largest valid document stays under MAX_RECORD_BYTES ──

type Path = (string | number)[];

function paths(value: unknown, test: (v: unknown) => boolean, path: Path = []): Path[] {
	const here = test(value) ? [path] : [];
	if (Array.isArray(value)) {
		return [...here, ...value.flatMap((v, i) => paths(v, test, [...path, i]))];
	}
	if (typeof value === "object" && value !== null) {
		return [...here, ...Object.entries(value).flatMap(([k, v]) => paths(v, test, [...path, k]))];
	}
	return here;
}

function setAt<T>(doc: T, path: Path, value: unknown): T {
	const out = structuredClone(doc) as Record<string | number, unknown>;
	if (!path.length) return value as T;
	let node = out;
	for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
	node[path[path.length - 1] as string | number] = value;
	return out as T;
}

function getAt(doc: unknown, path: Path): unknown {
	let node = doc as Record<string | number, unknown>;
	for (const key of path) node = node[key] as Record<string | number, unknown>;
	return node;
}

/** The largest `n` ≤ limit with `ok(n)`, given `ok(1)` (monotone). */
function maxValid(ok: (n: number) => boolean, limit: number): number {
	let lo = 1;
	let hi = 2;
	while (hi <= limit && ok(Math.min(hi, limit))) {
		lo = hi;
		hi *= 2;
	}
	hi = Math.min(hi, limit + 1);
	while (hi - lo > 1) {
		const mid = Math.floor((lo + hi) / 2);
		if (ok(mid)) lo = mid;
		else hi = mid;
	}
	return lo;
}

/**
 * Arrays filled to their maximum with copies of their first item, then every
 * string set to its longest valid value in the costliest character the
 * schema accepts there (`\u0001` is 6 bytes in JSON; where controls are
 * refused, `"` or a 3-byte character). Strings with a format keep their
 * value; link ids (`…Id`) stay ids (≤ 80 characters, spec §2.1);
 * discriminators (`type`) keep their value, since another type is another
 * (unknown, unbounded) record. Lengths are searched up to `MAX_RECORD_BYTES`
 * characters: a longer string is over the budget anyway.
 */
function largest(collection: Collection, doc: Record<string, unknown>): Record<string, unknown> {
	const schema = collectionSchemas[collection];
	const valid = (d: unknown) => schema.safeParse(d).success;
	let out = structuredClone(doc);
	for (const path of paths(out, (v) => Array.isArray(v) && v.length > 0)) {
		const list = getAt(out, path) as unknown[];
		const grown = (n: number) =>
			setAt(
				out,
				path,
				Array.from({ length: n }, () => list[0]),
			);
		if (!valid(grown(list.length))) continue;
		out = grown(maxValid((n) => valid(grown(n)), 200));
	}
	for (const path of paths(out, (v) => typeof v === "string")) {
		const last = path[path.length - 1];
		if (last === "type") continue;
		const limit =
			(typeof last === "string" && /Id$/.test(last)) || last === "id" ? 80 : MAX_RECORD_BYTES;
		let best = out;
		for (const char of ["\u0001", '"', "中"]) {
			const at = (n: number) => setAt(out, path, char.repeat(n));
			if (!valid(at(1))) continue;
			const candidate = at(maxValid((n) => valid(at(n)), limit));
			if (serializedBytes(candidate) > serializedBytes(best)) best = candidate;
		}
		out = best;
	}
	return out;
}

describe("record size budget", () => {
	// Unknown entry types and foreign configs are opaque (unbounded): the wire's
	// `too-large` check is their only bound, and a newer client owns their size.
	test("the largest valid entry of every type, escapes included, stays under MAX_RECORD_BYTES", () => {
		const docs = maximalDocuments().trackerEntries.filter((d) => isEntryType(d.type));
		const types = new Set(docs.map((d) => d.type as string));
		for (const type of ENTRY_TYPES) expect(types.has(type)).toBe(true);
		const sizes: Record<string, number> = {};
		for (const doc of docs) {
			const big = largest("trackerEntries", doc);
			expect(collectionSchemas.trackerEntries.safeParse(big).success).toBe(true);
			const bytes = serializedBytes(big);
			sizes[doc.type as string] = bytes;
			expect({ type: doc.type, under: bytes < MAX_RECORD_BYTES }).toEqual({
				type: doc.type,
				under: true,
			});
			expect(validateWireRecord(record("trackerEntries", big), CHECKED_AT).ok).toBe(true);
		}
		// The writing page is the largest: 16 000 three-byte units.
		expect(sizes.writing).toBeGreaterThan(48_000);
	});

	test("the largest valid habit with each tracker config stays under MAX_RECORD_BYTES", () => {
		const tracked = maximalDocuments().habits.filter((h) =>
			isKnownTrackerType((h.tracker as { type?: unknown } | null)?.type),
		);
		expect(tracked).toHaveLength(12);
		for (const habit of tracked) {
			const big = largest("habits", habit);
			expect(collectionSchemas.habits.safeParse(big).success).toBe(true);
			const type = (big.tracker as { type: string }).type;
			const bytes = serializedBytes(big);
			expect({ type, under: bytes < MAX_RECORD_BYTES }).toEqual({ type, under: true });
			expect(validateWireRecord(record("habits", big), CHECKED_AT).ok).toBe(true);
		}
	});
});
