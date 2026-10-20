import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { toDayKey } from "../src/dates";
import {
	JOURNAL_ANSWERS_MAX,
	JOURNAL_TEXT_MAX,
	type JournalEntry,
	collectionSchemas,
} from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, createAtomicStore } from "../src/store";
import {
	MAX_RECORD_BYTES,
	type WireSyncRecord,
	serializedBytes,
	validateWireRecord,
} from "../src/sync";
import { runSync } from "../src/sync-engine";
import { fakeSyncServer, wire } from "./support/sync-server";

/**
 * The journal half of the wire contract (spec §4.6, "per-collection
 * validation cases move to core tests of `validateWireRecord`"; Annex J §8
 * server cases): entries round-trip and converge (LWW, deletions), kinds and
 * fields from newer clients are kept verbatim, invalid entries are refused
 * per record with a path-only reason that never echoes content, and every
 * entry this build writes stays under `MAX_RECORD_BYTES`.
 */

const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const TODAY = toDayKey(NOW);
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

const record = (data: Record<string, unknown>): WireSyncRecord => ({
	collection: "journal",
	id: data.id as string,
	updatedAt: (data.updatedAt as number) ?? 2,
	deletedAt: (data.deletedAt as number | null) ?? null,
	data,
});
const check = (data: Record<string, unknown>) => validateWireRecord(record(data), CHECKED_AT);

const doc = (extra: Record<string, unknown> = {}) => ({
	id: "j1",
	createdAt: 1,
	updatedAt: 2,
	deletedAt: null,
	kind: "evidence",
	date: "2026-10-19",
	answers: { text: "Read 20 pages at the park" },
	...extra,
});

function makeStore(clock = { now: NOW }): AtomicStore {
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: () => clock.now,
		debounceMs: 0,
	});
	store.getState().actions.setTracking(true);
	return store;
}

const journalOf = (store: AtomicStore) => store.getState().data.journal;

describe("journal entries on the wire", () => {
	test("evidence, a recovery plan and a signed contract round-trip from phone to laptop unchanged", async () => {
		const server = makeServer();
		const clock = { now: NOW };
		const phone = makeStore(clock);
		const { actions } = phone.getState();
		const reader = actions.createIdentity({ statement: "I am a reader" });
		const read = actions.createHabit({ name: "Read", identityId: reader.id });
		const evidence = actions.createJournalEntry({
			kind: "evidence",
			identityId: reader.id,
			answers: { text: "Read 20 pages at the park" },
		});
		const plan = actions.createJournalEntry({
			kind: "recovery",
			habitId: read.id,
			date: "2026-10-19",
			answers: { obstacle: "Worked late", when: "07:00", where: "on the couch" },
		});
		const contract = actions.createJournalEntry({
			kind: "contract",
			habitId: read.id,
			answers: { commitment: "I will read, every day.", consequence: "pay Ana $20" },
			contract: { until: "2026-11-18", partner: "Ana", signedAt: null, outcome: null },
		});
		expect(actions.signContract(contract.id)).toBe(true);
		await runSync(phone, server.transport);

		for (const entry of [evidence, plan]) {
			expect(server.docs.get(`journal/${entry.id}`)?.data).toEqual(entry as never);
			expect(validateWireRecord(wire("journal", entry as never), CHECKED_AT)).toEqual({
				ok: true,
				data: entry as never,
			});
		}
		const laptop = makeStore({ now: NOW + 60_000 });
		await runSync(laptop, server.transport);
		const pulled = journalOf(laptop);
		expect(pulled[evidence.id]).toEqual(evidence);
		expect(pulled[plan.id]).toEqual(plan);
		expect(pulled[contract.id]).toEqual(journalOf(phone)[contract.id] as JournalEntry);
		expect(pulled[contract.id]?.contract?.signedAt).toBe(NOW);
		expect(pulled[plan.id]?.identityId).toBe(reader.id);
		expect(phone.getState().sync.pending[`journal/${evidence.id}`]).toBeUndefined();
	});

	test("a deletion converges, and so does its undo", async () => {
		const server = makeServer();
		const clock = { now: NOW };
		const phone = makeStore(clock);
		const laptop = makeStore(clock);
		const entry = phone
			.getState()
			.actions.createJournalEntry({ kind: "note", answers: { text: "Thinking" } });
		await runSync(phone, server.transport);
		await runSync(laptop, server.transport);
		clock.now += 1_000;
		phone.getState().actions.deleteJournalEntry(entry.id);
		await runSync(phone, server.transport);
		await runSync(laptop, server.transport);
		expect(journalOf(laptop)[entry.id]?.deletedAt).toBe(clock.now);
		expect(check({ ...(journalOf(laptop)[entry.id] as object), updatedAt: clock.now }).ok).toBe(
			true,
		);
		clock.now += 1_000;
		laptop.getState().actions.restoreJournalEntry(entry.id);
		await runSync(laptop, server.transport);
		await runSync(phone, server.transport);
		expect(journalOf(phone)[entry.id]?.deletedAt).toBeNull();
	});

	test("last write wins per entry: two devices edit offline, both converge on the newer edit", async () => {
		const server = makeServer();
		const clock = { now: NOW };
		const phone = makeStore(clock);
		const laptop = makeStore(clock);
		const entry = phone.getState().actions.createJournalEntry({
			kind: "review",
			range: { from: "2026-10-12", to: "2026-10-18" },
			answers: { well: "Read daily" },
		});
		await runSync(phone, server.transport);
		await runSync(laptop, server.transport);
		clock.now += 1_000;
		phone.getState().actions.updateJournalEntry(entry.id, {
			answers: { well: "Read daily", learned: "Phone edit" },
		});
		clock.now += 1_000;
		laptop.getState().actions.updateJournalEntry(entry.id, {
			answers: { well: "Read daily", learned: "Laptop edit (newer)" },
		});
		await runSync(phone, server.transport);
		await runSync(laptop, server.transport);
		await runSync(phone, server.transport);
		expect(journalOf(phone)[entry.id]?.answers.learned).toBe("Laptop edit (newer)");
		expect(journalOf(laptop)[entry.id]).toEqual(journalOf(phone)[entry.id] as JournalEntry);
		expect(server.docs.get(`journal/${entry.id}`)?.updatedAt).toBe(clock.now);
	});

	test("a kind and fields from a newer client are accepted and kept verbatim, nested ones too", async () => {
		const future = doc({
			kind: "future-kind",
			answers: { text: "From a newer app", insight: "Deep" },
			mood: { valence: 3, tags: ["calm"] },
			contract: {
				until: "2026-11-01",
				partner: null,
				signedAt: null,
				outcome: null,
				witness: "Leo",
			},
			range: { from: "2026-10-01", to: "2026-10-31", label: "Autumn" },
		});
		expect(check(future)).toEqual({ ok: true, data: future });
		const server = makeServer();
		expect((await server.transport.push({ records: [record(future)] })).accepted).toBe(1);
		const store = makeStore();
		await runSync(store, server.transport);
		const stored = journalOf(store).j1 as JournalEntry & Record<string, unknown>;
		expect(stored).toMatchObject({
			kind: "future-kind",
			mood: { valence: 3, tags: ["calm"] },
			contract: { witness: "Leo" },
			range: { label: "Autumn" },
			answers: { insight: "Deep" },
		});
		// A minimal entry is not padded with defaults on the wire.
		const minimal = {
			id: "j2",
			createdAt: 1,
			updatedAt: 2,
			deletedAt: null,
			kind: "note",
			date: TODAY,
		};
		expect(check(minimal)).toEqual({ ok: true, data: minimal });
	});

	test("invalid entries are refused with a path and an issue code, never with their content", () => {
		const answers = (n: number) =>
			Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, CANARY]));
		const cases: [Record<string, unknown>, RegExp][] = [
			[doc({ answers: { text: `${CANARY}${"x".repeat(8_000)}` } }), /^answers\.text: too_big$/],
			[doc({ answers: answers(JOURNAL_ANSWERS_MAX + 1) }), /^answers: custom$/],
			[
				doc({
					answers: {
						a: CANARY + "x".repeat(7_000),
						b: CANARY + "x".repeat(7_000),
						c: CANARY + "x".repeat(7_000),
					},
				}),
				/^answers: custom$/,
			],
			[doc({ answers: { text: 42 } }), /^answers\.text: invalid_type$/],
			[
				doc({ contract: { until: `2026-13-01${CANARY}`, partner: CANARY } }),
				/^contract\.until: custom$/,
			],
			[doc({ contract: { partner: CANARY } }), /^contract\.until: invalid_type$/],
			[
				doc({ contract: { until: "2026-11-01", outcome: CANARY } }),
				/^contract\.outcome: invalid_value$/,
			],
			[doc({ range: { from: "2026-10-10", to: "2026-10-01" } }), /^range: custom$/],
			[doc({ rating: CANARY }), /^rating: invalid_value$/],
			[doc({ difficulty: CANARY }), /^difficulty: invalid_value$/],
			[doc({ date: CANARY }), /^date: custom$/],
			[doc({ kind: "" }), /^kind: too_small$/],
			[doc({ kind: `k${"x".repeat(32)}` }), /^kind: too_big$/],
			[doc({ pinned: CANARY }), /^pinned: invalid_type$/],
		];
		for (const [data, reason] of cases) {
			const result = check(data);
			expect(result.ok).toBe(false);
			if (result.ok) continue;
			expect({ reason: result.reason, code: result.code }).toEqual({
				reason: expect.stringMatching(reason),
				code: "invalid",
			});
			expect(JSON.stringify(result)).not.toContain(CANARY);
		}
		// A bad prompt id is refused at its key (the id is the path, never the answer).
		const badId = check(doc({ answers: { "Bad-Id": CANARY } }));
		expect(badId).toEqual({ ok: false, code: "invalid", reason: "answers.Bad-Id: invalid_key" });
		// Tombstones are valid documents too.
		expect(check(doc({ deletedAt: 5, updatedAt: 5 })).ok).toBe(true);
	});

	test("bad entries are refused per record while the rest of the batch is stored", async () => {
		const server = makeServer();
		const good = doc();
		const future = doc({ id: "j2", kind: "future-kind" });
		const tooLong = doc({ id: "j3", answers: { text: "x".repeat(8_001) } });
		const badUntil = doc({ id: "j4", kind: "contract", contract: { until: "soon" } });
		const out = await server.transport.push({
			records: [good, tooLong, future, badUntil].map(record),
		});
		expect(out.accepted).toBe(2);
		expect(out.rejected).toEqual([
			{ collection: "journal", id: "j3", reason: "answers.text: too_big", code: "invalid" },
			{ collection: "journal", id: "j4", reason: "contract.until: custom", code: "invalid" },
		]);
		expect([...server.docs.keys()].sort()).toEqual(["journal/j1", "journal/j2"]);
	});
});

// ── Size budget (spec §4.6: the largest valid document, including escapes) ──

/** Twelve answer ids of the longest valid length (32 characters). */
const IDS = Array.from(
	{ length: JOURNAL_ANSWERS_MAX },
	(_, i) => `a${String(i).padStart(31, "0")}`,
);

/** `units` UTF-16 units split over the twelve ids, each answer made of `char`. */
function fill(char: string, units = JOURNAL_TEXT_MAX): Record<string, string> {
	const per = Math.floor(units / IDS.length / char.length) * char.length;
	const out: Record<string, string> = {};
	IDS.forEach((id, i) => {
		const extra = i === IDS.length - 1 ? units - per * IDS.length : 0;
		out[id] = char.repeat((per + extra) / char.length);
	});
	return out;
}

describe("size budget", () => {
	test("every entry the store writes stays under MAX_RECORD_BYTES, whatever was typed", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const longId = "h".repeat(80);
		// The costliest characters per UTF-16 unit: 3-byte BMP text, escaped quotes and
		// backslashes, surrogate pairs, plus what the sanitizer drops (controls, lone surrogates).
		const inputs = ["中", '"', "\\", "😀", "\u0001", "\ud800", " ", "é"];
		for (const char of inputs) {
			const entry = actions.createJournalEntry({
				kind: "contract",
				date: TODAY,
				identityId: longId,
				habitId: longId,
				answers: fill(char),
				rating: "positive",
				difficulty: "just-right",
				range: { from: "2026-10-01", to: "2026-10-31" },
				contract: {
					until: "2026-11-18",
					partner: char.repeat(80 / char.length),
					signedAt: null,
					outcome: null,
				},
				pinned: true,
			});
			const bytes = serializedBytes(entry);
			expect({ char, under: bytes <= MAX_RECORD_BYTES }).toEqual({ char, under: true });
			expect(check(entry as never).ok).toBe(true);
			expect(collectionSchemas.journal.safeParse(entry).success).toBe(true);
		}
		// The 3-byte case is the worst one left, and it keeps a margin.
		const worst = journalOf(store);
		const max = Math.max(...Object.values(worst).map((e) => serializedBytes(e)));
		expect(max).toBeGreaterThan(60_000);
		expect(max).toBeLessThan(MAX_RECORD_BYTES - 2_000);
	});

	test("updates are held to the same budget", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const entry = actions.createJournalEntry({ kind: "note", answers: { text: "short" } });
		actions.updateJournalEntry(entry.id, { answers: fill("\u0001") });
		expect(journalOf(store)[entry.id]?.answers).toEqual({});
		actions.updateJournalEntry(entry.id, { answers: fill("中") });
		const updated = journalOf(store)[entry.id] as JournalEntry;
		expect(serializedBytes(updated)).toBeLessThan(MAX_RECORD_BYTES);
		expect(check(updated as never).ok).toBe(true);
	});

	/**
	 * DATA-LAYER GAP (owner F, `model.ts`; reported by T3, not fixed here): the
	 * journal schema bounds answers in UTF-16 units (≤ 20,000), but a control
	 * character costs 6 bytes in JSON (`\u0001`), so a schema-valid entry can
	 * reach ~120 KB and every server refuses it as `too-large`; the engine then
	 * drops the key, so the entry never syncs. The store's sanitizer
	 * (`stripUnsafeText`) keeps this out of everything the app writes; what is
	 * left is data that bypasses it (a backup import, a record from another
	 * client). Expected to pass once `journalAnswersSchema` bounds the encoded
	 * size (or refuses control characters and lone surrogates): then turn
	 * `test.failing` into `test`.
	 */
	test.failing("the largest schema-valid journal entry stays under MAX_RECORD_BYTES", () => {
		const largest = doc({ answers: fill("\u0001") });
		expect(collectionSchemas.journal.safeParse(largest).success).toBe(true);
		expect(serializedBytes(largest)).toBeLessThanOrEqual(MAX_RECORD_BYTES);
	});
});
