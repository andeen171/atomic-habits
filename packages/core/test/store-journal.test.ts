import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { localOnlyCollections, sanitizeJournalAnswers } from "../src/actions/journal";
import { toDayKey } from "../src/dates";
import { isJournalKind } from "../src/journal";
import {
	EXPORT_FORMAT,
	JOURNAL_ANSWER_MAX,
	JOURNAL_KINDS,
	JOURNAL_TEXT_MAX,
	type JournalEntry,
	exportFileSchema,
	journalEntrySchema,
} from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, type StoreNotice, createAtomicStore } from "../src/store";
import { runSync } from "../src/sync-engine";
import { fakeSyncServer, wire } from "./support/sync-server";

/**
 * Annex J §8 store and schema cases, as amended by the spec: the store's
 * generic answer sanitizer (§3.4), `signContract` returning a boolean (§3.1),
 * locked fields, the device-local "Sync journal" switch (D19), and the
 * cascades that never touch the journal (D18).
 */

const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const TODAY = toDayKey(NOW);

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

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

const entryOf = (store: AtomicStore, id: string) =>
	store.getState().data.journal[id] as JournalEntry;
const pending = (store: AtomicStore, key: string) => store.getState().sync.pending[key] === true;

describe("schema (Annex J §8)", () => {
	const base = {
		id: "j1",
		kind: "note",
		date: TODAY,
		createdAt: NOW,
		updatedAt: NOW,
		deletedAt: null,
	};

	test("isJournalKind knows the nine kinds; newer kinds are still valid entries", () => {
		for (const kind of JOURNAL_KINDS) expect(isJournalKind(kind)).toBe(true);
		for (const value of ["dayNote", "future-kind", "", null, 3, "Evidence"]) {
			expect(isJournalKind(value)).toBe(false);
		}
		expect(journalEntrySchema.safeParse({ ...base, kind: "future-kind" }).success).toBe(true);
	});

	test("a minimal entry parses with defaults; unknown kinds are accepted", () => {
		expect(journalEntrySchema.parse(base)).toEqual({
			...base,
			identityId: null,
			habitId: null,
			answers: {},
			rating: null,
			difficulty: null,
			range: null,
			contract: null,
			pinned: false,
		});
		expect(journalEntrySchema.safeParse({ ...base, kind: "future-kind" }).success).toBe(true);
	});

	test("answer limits, ranges and contracts are enforced; old exports parse with an empty journal", () => {
		const answers = (n: number, length = 1) =>
			Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, "x".repeat(length)]));
		expect(journalEntrySchema.safeParse({ ...base, answers: answers(12) }).success).toBe(true);
		expect(journalEntrySchema.safeParse({ ...base, answers: answers(13) }).success).toBe(false);
		expect(
			journalEntrySchema.safeParse({
				...base,
				answers: { text: "x".repeat(JOURNAL_ANSWER_MAX + 1) },
			}).success,
		).toBe(false);
		expect(journalEntrySchema.safeParse({ ...base, answers: answers(3, 7_000) }).success).toBe(
			false,
		);
		expect(
			journalEntrySchema.safeParse({ ...base, range: { from: "2026-10-10", to: "2026-10-01" } })
				.success,
		).toBe(false);
		expect(
			journalEntrySchema.safeParse({ ...base, contract: { until: "2026-13-01" } }).success,
		).toBe(false);
		const old = exportFileSchema.parse({
			format: EXPORT_FORMAT,
			version: 1,
			exportedAt: NOW,
			data: {},
		});
		expect(old.data.journal).toEqual([]);
	});
});

describe("sanitizeJournalAnswers (spec §3.4 store backstop)", () => {
	test("CRLF → LF, trim, drop empty and invalid ids, clamp per answer, count and total", () => {
		expect(
			sanitizeJournalAnswers({
				text: "  Line one\r\nLine two\r ",
				empty: "   ",
				"Bad-Id": "dropped",
				number: 4,
				ok: "fine",
			}),
		).toEqual({ text: "Line one\nLine two", ok: "fine" });
		expect(sanitizeJournalAnswers({ text: "x".repeat(9_000) }).text).toHaveLength(
			JOURNAL_ANSWER_MAX,
		);
		const many = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`a${i}`, "y"]));
		expect(Object.keys(sanitizeJournalAnswers(many))).toHaveLength(12);
		const big = sanitizeJournalAnswers({
			a: "x".repeat(8_000),
			b: "x".repeat(8_000),
			c: "x".repeat(8_000),
		});
		expect(Object.values(big).reduce((n, v) => n + v.length, 0)).toBe(JOURNAL_TEXT_MAX);
		expect(big.c).toHaveLength(4_000);
		// A cut never leaves half of a surrogate pair.
		const emoji = sanitizeJournalAnswers({ a: `${"x".repeat(JOURNAL_ANSWER_MAX - 1)}🎉` });
		expect(emoji.a).toHaveLength(JOURNAL_ANSWER_MAX - 1);
		expect(sanitizeJournalAnswers(null)).toEqual({});
		expect(sanitizeJournalAnswers(["a"])).toEqual({});
	});
});

describe("journal actions (Annex J §3.3)", () => {
	test("createJournalEntry sanitizes, defaults the date, copies a live identity, marks pending; throws on invalid", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const identity = actions.createIdentity({ statement: "I am a reader" });
		const habit = actions.createHabit({ name: "Read", identityId: identity.id });
		const entry = actions.createJournalEntry({
			kind: "evidence",
			habitId: habit.id,
			answers: { text: "  Read 20 pages\r\nat the park  ", "Bad-Id": "x", other: "" },
		});
		expect(entry).toMatchObject({
			kind: "evidence",
			date: TODAY,
			habitId: habit.id,
			identityId: identity.id,
			answers: { text: "Read 20 pages\nat the park" },
			createdAt: NOW,
			updatedAt: NOW,
		});
		expect(entryOf(store, entry.id)).toBe(entry);
		expect(pending(store, `journal/${entry.id}`)).toBe(true);
		// An explicit null identity stays null; a deleted identity isn't copied.
		expect(
			actions.createJournalEntry({ kind: "note", habitId: habit.id, identityId: null }).identityId,
		).toBeNull();
		actions.deleteIdentity(identity.id);
		const other = actions.createHabit({ name: "Write" });
		store.setState((s) => ({
			data: {
				...s.data,
				habits: { ...s.data.habits, [other.id]: { ...other, identityId: identity.id } },
			},
		}));
		expect(actions.createJournalEntry({ kind: "note", habitId: other.id }).identityId).toBeNull();
		expect(() => actions.createJournalEntry({ kind: "", date: TODAY })).toThrow();
		expect(() => actions.createJournalEntry({ kind: "note", date: "yesterday" })).toThrow();
		// Contract partners are cleaned.
		const contract = actions.createJournalEntry({
			kind: "contract",
			contract: { until: "2026-11-18", partner: "  ", signedAt: null, outcome: null },
		});
		expect(contract.contract?.partner).toBeNull();
	});

	test("updates are stamped strictly newer; kind is fixed; habitId is fixed for recovery, check-in and contract", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		const a = actions.createHabit({ name: "A" });
		const b = actions.createHabit({ name: "B" });
		const recovery = actions.createJournalEntry({
			kind: "recovery",
			habitId: a.id,
			answers: { obstacle: "Late" },
		});
		// Same clock: still strictly newer.
		actions.updateJournalEntry(recovery.id, {
			kind: "note",
			habitId: b.id,
			answers: { obstacle: "Late again", when: "07:00" },
			pinned: true,
		});
		const updated = entryOf(store, recovery.id);
		expect(updated.updatedAt).toBe(NOW + 1);
		expect(updated).toMatchObject({
			kind: "recovery",
			habitId: a.id,
			answers: { obstacle: "Late again", when: "07:00" },
			pinned: true,
		});
		const evidence = actions.createJournalEntry({ kind: "evidence", habitId: a.id });
		actions.updateJournalEntry(evidence.id, { habitId: b.id });
		expect(entryOf(store, evidence.id).habitId).toBe(b.id);
		// An empty patch writes nothing.
		const before = entryOf(store, evidence.id);
		actions.updateJournalEntry(evidence.id, {});
		expect(entryOf(store, evidence.id)).toBe(before);
	});

	test("delete and restore produce a tombstone and bring it back", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		const entry = actions.createJournalEntry({ kind: "note", answers: { text: "Hi" } });
		clock.now += 1_000;
		actions.deleteJournalEntry(entry.id);
		expect(entryOf(store, entry.id).deletedAt).toBe(clock.now);
		actions.updateJournalEntry(entry.id, { pinned: true }); // a tombstone isn't edited
		expect(entryOf(store, entry.id).pinned).toBe(false);
		clock.now += 1_000;
		actions.restoreJournalEntry(entry.id);
		expect(entryOf(store, entry.id)).toMatchObject({ deletedAt: null, updatedAt: clock.now });
	});

	test("contracts: sign only when complete; signed contracts are locked until revoked; outcomes on signed ones", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		const habit = actions.createHabit({ name: "Work out" });
		const contract = actions.createJournalEntry({
			kind: "contract",
			habitId: habit.id,
			answers: { commitment: "I will work out, 3 times a week." },
			contract: { until: "2026-11-18", partner: "Ana", signedAt: null, outcome: null },
		});
		expect(actions.signContract(contract.id)).toBe(false); // no consequence yet
		actions.setContractOutcome(contract.id, "kept"); // not signed: no-op
		expect(entryOf(store, contract.id).contract?.outcome).toBeNull();
		actions.updateJournalEntry(contract.id, {
			answers: { commitment: "I will work out, 3 times a week.", consequence: "Pay Ana $20" },
		});
		clock.now += 1_000;
		expect(actions.signContract(contract.id)).toBe(true);
		expect(entryOf(store, contract.id).contract?.signedAt).toBe(clock.now);
		expect(actions.signContract(contract.id)).toBe(false); // already signed

		// Locked: only `pinned` changes; the signature can't be patched away.
		actions.updateJournalEntry(contract.id, {
			answers: { commitment: "Nothing", consequence: "None" },
			contract: { until: "2027-01-01", partner: null, signedAt: null, outcome: null },
			pinned: true,
		});
		expect(entryOf(store, contract.id)).toMatchObject({
			answers: { consequence: "Pay Ana $20" },
			contract: { until: "2026-11-18", partner: "Ana", signedAt: clock.now },
			pinned: true,
		});
		actions.setContractOutcome(contract.id, "kept");
		expect(entryOf(store, contract.id).contract?.outcome).toBe("kept");
		actions.revokeContractSignature(contract.id);
		actions.updateJournalEntry(contract.id, {
			contract: { until: "2026-12-01", partner: " Bia ", signedAt: 5, outcome: "broken" },
		});
		expect(entryOf(store, contract.id).contract).toEqual({
			until: "2026-12-01",
			partner: "Bia",
			signedAt: null,
			outcome: "kept",
		});

		// Other kinds, entries without a habit or an end date never sign.
		const note = actions.createJournalEntry({
			kind: "note",
			habitId: habit.id,
			answers: { commitment: "a", consequence: "b" },
			contract: { until: "2026-11-18", partner: null, signedAt: null, outcome: null },
		});
		expect(actions.signContract(note.id)).toBe(false);
		const loose = actions.createJournalEntry({
			kind: "contract",
			answers: { commitment: "a", consequence: "b" },
			contract: { until: "2026-11-18", partner: null, signedAt: null, outcome: null },
		});
		expect(actions.signContract(loose.id)).toBe(false);
		expect(actions.signContract("missing")).toBe(false);
	});

	test("deleteIdentity and deleteHabit leave journal entries byte-identical (D18)", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const identity = actions.createIdentity({ statement: "I am present" });
		const habit = actions.createHabit({ name: "Call", identityId: identity.id });
		const entry = actions.createJournalEntry({
			kind: "evidence",
			habitId: habit.id,
			answers: { text: "Called" },
		});
		const journal = store.getState().data.journal;
		actions.deleteHabit(habit.id);
		actions.deleteIdentity(identity.id);
		expect(store.getState().data.journal).toBe(journal);
		expect(entryOf(store, entry.id)).toBe(entry);
	});

	test("superseded entries are read-only (spec §2.7)", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const notices: StoreNotice[] = [];
		store.subscribeNotices((n) => notices.push(n));
		const entry = actions.createJournalEntry({ kind: "note", answers: { text: "Hi" } });
		actions.applyRemote([
			wire("journal", { ...entry, updatedAt: NOW + 50, answers: { text: 42 } } as never),
		]);
		expect(store.getState().sync.superseded[`journal/${entry.id}`]).toBe(NOW + 50);
		actions.updateJournalEntry(entry.id, { pinned: true });
		expect(entryOf(store, entry.id)).toBe(entry);
		expect(notices).toEqual([{ type: "superseded", key: `journal/${entry.id}` }]);
	});
});

describe("journal data paths (Annex J §2.5, §8)", () => {
	test("export includes the journal; merge and replace import it; replace tombstones absent entries; reset clears it", () => {
		const clock = { now: NOW };
		const a = makeStore(clock);
		const kept = a
			.getState()
			.actions.createJournalEntry({ kind: "note", answers: { text: "Keep" } });
		const file = a.getState().actions.exportData();
		expect(file.version).toBe(2);
		expect(file.data.journal).toEqual([kept]);

		const b = makeStore(clock);
		const local = b
			.getState()
			.actions.createJournalEntry({ kind: "note", answers: { text: "Local" } });
		clock.now += 1_000;
		expect(b.getState().actions.importData(file, "merge")).toMatchObject({ ok: true, imported: 1 });
		expect(entryOf(b, kept.id).answers.text).toBe("Keep");
		expect(entryOf(b, local.id).deletedAt).toBeNull();
		clock.now += 1_000;
		b.getState().actions.importData(file, "replace");
		expect(entryOf(b, local.id).deletedAt).toBe(clock.now);
		expect(entryOf(b, kept.id).deletedAt).toBeNull();
		// A v1 backup's replace never touches the journal.
		clock.now += 1_000;
		b.getState().actions.importData({ ...file, version: 1, data: { habits: [] } }, "replace");
		expect(entryOf(b, kept.id).deletedAt).toBeNull();
		b.getState().actions.resetAll();
		expect(b.getState().data.journal).toEqual({});
	});

	test("applyRemote keeps unknown fields; an update keeps an unknown kind and its fields", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const remote = {
			id: "j9",
			kind: "future",
			date: TODAY,
			answers: { text: "From a newer app", insight: "Deep" },
			contract: {
				until: "2026-11-01",
				partner: null,
				signedAt: null,
				outcome: null,
				witness: "Leo",
			},
			mood: { valence: 3 },
			createdAt: NOW - 10,
			updatedAt: NOW - 10,
			deletedAt: null,
		};
		store.getState().actions.applyRemote([wire("journal", remote)]);
		expect(entryOf(store, "j9")).toMatchObject({
			mood: { valence: 3 },
			contract: { witness: "Leo" },
		});
		clock.now += 1_000;
		store.getState().actions.updateJournalEntry("j9", { pinned: true });
		expect(entryOf(store, "j9")).toMatchObject({
			kind: "future",
			pinned: true,
			mood: { valence: 3 },
			answers: { insight: "Deep" },
			contract: { witness: "Leo" },
		});
	});
});

describe("device-local Sync journal switch (D19)", () => {
	test("off: journal keys stay pending on the device, aren't pushed or held back; other devices' entries still arrive", async () => {
		const server = fakeSyncServer({ clockOffsetMs: NOW + 3_600_000 - Date.now() });
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		actions.updateSettings({ syncJournal: false });
		expect(localOnlyCollections(store.getState().settings)).toEqual(["journal"]);
		expect(localOnlyCollections({ syncJournal: true })).toEqual([]);
		const mine = actions.createJournalEntry({ kind: "note", answers: { text: "Private" } });
		const habit = actions.createHabit({ name: "Read" });
		server.put(
			wire("journal", {
				id: "theirs",
				kind: "note",
				date: TODAY,
				answers: { text: "From the phone" },
				createdAt: NOW - 5,
				updatedAt: NOW - 5,
				deletedAt: null,
			}),
		);
		const result = await runSync(store, server.transport, {
			localOnly: localOnlyCollections(store.getState().settings),
		});
		expect(result).toMatchObject({ localOnly: 1, heldBack: 0 });
		expect(server.docs.has(`journal/${mine.id}`)).toBe(false);
		expect(server.docs.has(`habits/${habit.id}`)).toBe(true);
		expect(pending(store, `journal/${mine.id}`)).toBe(true);
		expect(entryOf(store, "theirs").answers.text).toBe("From the phone");

		// Turning it back on uploads what was written meanwhile.
		actions.updateSettings({ syncJournal: true });
		await runSync(store, server.transport, {
			localOnly: localOnlyCollections(store.getState().settings),
		});
		expect(server.docs.has(`journal/${mine.id}`)).toBe(true);
		expect(pending(store, `journal/${mine.id}`)).toBe(false);
	});
});
