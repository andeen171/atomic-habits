import { describe, expect, test } from "bun:test";
import { toDayKey } from "../src/dates";
import { createId } from "../src/ids";
import { type Task, collectionSchemas, taskLogId } from "../src/model";
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
import { REPEAT_RULES, maximalDocuments } from "./support/v2-documents";

/**
 * The tasks half of the wire contract (spec §4.6, "per-collection validation
 * cases move to core tests of `validateWireRecord`"; Annex T §8.5): task logs
 * round-trip, bad logs are refused per record, rules from newer clients pass
 * verbatim, malformed known rules and v2 task fields are refused with a
 * path-only reason, and the largest valid series stays under the size cap.
 */

const NOW = new Date(2026, 9, 14, 10, 0).getTime();
const TODAY = toDayKey(NOW);
/** The server clock for `validateWireRecord` (a minute after the devices' clock). */
const CHECKED_AT = NOW + 60_000;

const record = (collection: string, data: Record<string, unknown>): WireSyncRecord => ({
	collection,
	id: data.id as string,
	updatedAt: (data.updatedAt as number) ?? 2,
	deletedAt: (data.deletedAt as number | null) ?? null,
	data,
});
const check = (collection: string, data: Record<string, unknown>) =>
	validateWireRecord(record(collection, data), CHECKED_AT);

const taskDoc = (extra: Record<string, unknown> = {}) => ({
	id: "t1",
	createdAt: 1,
	updatedAt: 2,
	deletedAt: null,
	title: "Water the plants",
	date: "2026-10-01",
	...extra,
});
const logDoc = (extra: Record<string, unknown> = {}) => ({
	id: taskLogId("t1", "2026-10-13"),
	createdAt: 1,
	updatedAt: 2,
	deletedAt: null,
	taskId: "t1",
	date: "2026-10-13",
	status: "done",
	resolvedOn: TODAY,
	...extra,
});

function makeStore(now = NOW): AtomicStore {
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: () => now,
		debounceMs: 0,
	});
	store.getState().actions.setTracking(true);
	return store;
}

describe("taskLogs on the wire", () => {
	test("a completion round-trips through the server unchanged", async () => {
		const server = fakeSyncServer();
		const phone = makeStore();
		const t = phone.getState().actions.createTask({
			title: "Vitamins",
			date: "2026-10-12",
			repeat: { type: "days", every: 1 },
		});
		const log = phone.getState().actions.completeOccurrence(t.id, TODAY);
		expect(log).not.toBeNull();
		await runSync(phone, server.transport);
		const id = taskLogId(t.id, TODAY);
		const stored = server.docs.get(`taskLogs/${id}`);
		expect(stored?.data).toEqual(log as never);
		expect(validateWireRecord(wire("taskLogs", log as never), CHECKED_AT)).toEqual({
			ok: true,
			data: log as never,
		});
		const laptop = makeStore(NOW + 60_000);
		await runSync(laptop, server.transport);
		expect(laptop.getState().data.taskLogs[id]).toEqual(log as never);
		expect(phone.getState().sync.pending[`taskLogs/${id}`]).toBeUndefined();
	});

	test("deterministic ids: a UUID task's log id fits the 80-character id limit", () => {
		const id = taskLogId(createId(), "2026-10-14");
		expect(id).toHaveLength(47);
		expect(check("taskLogs", logDoc({ id })).ok).toBe(true);
	});

	test("an invalid status, a missing resolvedOn, a bad date or no task id are refused, without values", () => {
		const { resolvedOn: _resolvedOn, ...noResolvedOn } = logDoc();
		const cases: [Record<string, unknown>, string][] = [
			[logDoc({ status: "maybe-canary" }), "status: invalid_value"],
			[noResolvedOn, "resolvedOn: invalid_type"],
			[logDoc({ date: "2026-02-30" }), "date: custom"],
			[logDoc({ resolvedOn: "canary" }), "resolvedOn: custom"],
			[logDoc({ taskId: "" }), "taskId: too_small"],
		];
		for (const [doc, reason] of cases) {
			const result = check("taskLogs", doc);
			expect(result).toEqual({ ok: false, code: "invalid", reason });
			expect(JSON.stringify(result)).not.toContain("canary");
		}
		// A skip is valid; a tombstone too. The status defaults to done when absent.
		expect(check("taskLogs", logDoc({ status: "skipped" })).ok).toBe(true);
		expect(check("taskLogs", logDoc({ deletedAt: 5 })).ok).toBe(true);
		const { status: _status, ...noStatus } = logDoc();
		expect(collectionSchemas.taskLogs.parse(noStatus).status).toBe("done");
	});

	test("bad logs are refused per record while the rest of the batch is stored", async () => {
		const server = fakeSyncServer();
		const good = logDoc();
		const skipped = logDoc({
			id: taskLogId("t1", "2026-10-12"),
			date: "2026-10-12",
			status: "skipped",
		});
		const badStatus = logDoc({
			id: taskLogId("t1", "2026-10-11"),
			date: "2026-10-11",
			status: "x",
		});
		const { resolvedOn: _r, ...noResolvedOn } = logDoc({
			id: taskLogId("t1", "2026-10-10"),
			date: "2026-10-10",
		});
		const out = await server.transport.push({
			records: [good, badStatus, wire("tasks", taskDoc()), noResolvedOn, skipped].map((doc) =>
				"taskId" in doc ? wire("taskLogs", doc) : (doc as WireSyncRecord),
			),
		});
		expect(out.accepted).toBe(3);
		expect(out.rejected).toEqual([
			{
				collection: "taskLogs",
				id: badStatus.id,
				reason: "status: invalid_value",
				code: "invalid",
			},
			{
				collection: "taskLogs",
				id: noResolvedOn.id,
				reason: "resolvedOn: invalid_type",
				code: "invalid",
			},
		]);
		expect([...server.docs.keys()].sort()).toEqual(
			[`taskLogs/${good.id}`, `taskLogs/${skipped.id}`, "tasks/t1"].sort(),
		);
	});
});

describe("tasks with repeat rules on the wire", () => {
	test("every known rule passes with the data verbatim: no defaults added, unknown nested keys kept", () => {
		for (const [type, rule] of Object.entries(REPEAT_RULES)) {
			const repeat = { ...rule, fromNewerBuild: { nested: [1, 2] } };
			const doc = taskDoc({ repeat });
			const result = check("tasks", doc);
			expect({ type, ok: result.ok }).toEqual({ type, ok: true });
			expect(result.ok && result.data).toEqual(doc);
		}
		// A minimal known rule is not padded with its defaults on the wire.
		const minimal = taskDoc({ repeat: { type: "days" } });
		expect(check("tasks", minimal)).toEqual({ ok: true, data: minimal });
	});

	test("a rule type from a newer client is accepted and stored verbatim (R16, D-open discriminators)", async () => {
		const repeat = { type: "quarterly", months: [1, 4, 7, 10], skip: { holidays: "BR" } };
		const doc = taskDoc({ repeat, time: "09:30", habitId: "h1", law: 4, habitField: "future" });
		expect(check("tasks", doc)).toEqual({ ok: true, data: doc });
		const server = fakeSyncServer();
		const out = await server.transport.push({ records: [wire("tasks", doc)] });
		expect(out.accepted).toBe(1);
		expect(server.docs.get("tasks/t1")?.data).toEqual(doc);
		// A device applies it as a read-only series and keeps the rule as is.
		const store = makeStore();
		await runSync(store, server.transport);
		expect((store.getState().data.tasks.t1 as Task).repeat).toEqual(repeat as never);
	});

	test("malformed known rules are refused at `repeat`, with a path and an issue code only", () => {
		// Which union issue zod reports (invalid_union or the refinement's custom) is its own
		// business; the contract is the path, a code and no value.
		const cases: Record<string, unknown>[] = [
			{ type: "days", every: 0 },
			{ type: "days", every: 366 },
			{ type: "weeks", every: 1, days: [] },
			{ type: "weeks", every: 1, days: [7] },
			{ type: "weeks", every: 1, days: [1], weekStart: 3 },
			{ type: "months", every: 1 },
			{ type: "months", every: 1, day: 32 },
			{ type: "after", every: 2, unit: "years-canary" },
			{ type: "days", every: 1, until: "canary" },
			{ type: "days", every: 1, count: 0 },
			{ every: 1 },
		];
		for (const repeat of cases) {
			const result = check("tasks", taskDoc({ repeat }));
			expect({ repeat, ok: result.ok, code: !result.ok && result.code }).toEqual({
				repeat,
				ok: false,
				code: "invalid",
			});
			expect(!result.ok && result.reason).toMatch(/^repeat: (invalid_union|custom)$/);
			expect(JSON.stringify(result)).not.toContain("canary");
		}
		expect(check("tasks", taskDoc({ repeat: { type: "" } }))).toEqual({
			ok: false,
			code: "invalid",
			reason: "repeat.type: too_small",
		});
	});

	test("the v2 task fields are checked: law, time, habit link, field and source entry", () => {
		const cases: [Record<string, unknown>, string][] = [
			[{ law: 5 }, "law: invalid_union"],
			[{ time: "24:00" }, "time: invalid_format"],
			[{ habitId: "h".repeat(81) }, "habitId: too_big"],
			[{ habitField: "f".repeat(33) }, "habitField: too_big"],
			[{ sourceEntryId: "e".repeat(81) }, "sourceEntryId: too_big"],
			[{ lang: "x".repeat(11) }, "lang: too_big"],
		];
		for (const [extra, reason] of cases) {
			expect(check("tasks", taskDoc(extra))).toEqual({ ok: false, code: "invalid", reason });
		}
		const linked = taskDoc({
			repeat: REPEAT_RULES.weeks,
			time: "07:15",
			habitId: "h1",
			law: 1,
			habitField: "environment",
			sourceEntryId: null,
			lang: "pt-BR",
		});
		expect(check("tasks", linked)).toEqual({ ok: true, data: linked });
	});
});

// ── Size budget: the largest valid series per rule type ──

type Path = (string | number)[];

function stringPaths(value: unknown, path: Path = []): Path[] {
	if (typeof value === "string") return [path];
	if (Array.isArray(value)) return value.flatMap((v, i) => stringPaths(v, [...path, i]));
	if (typeof value === "object" && value !== null) {
		return Object.entries(value).flatMap(([k, v]) => stringPaths(v, [...path, k]));
	}
	return [];
}

function setAt<T>(doc: T, path: Path, value: unknown): T {
	const out = structuredClone(doc) as Record<string | number, unknown>;
	let node = out;
	for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
	node[path[path.length - 1] as string | number] = value;
	return out as T;
}

/**
 * Every free-text string at its longest valid value made of `\u0001` (6 JSON
 * bytes per UTF-16 unit, the worst case). Formatted strings (days, times,
 * enums) keep their value, and so does the rule's `type`: another type would
 * turn the rule into a newer client's, whose keys are not bounded here. Link
 * ids are ids: at most 80 characters.
 */
function largestTask(doc: Record<string, unknown>): Record<string, unknown> {
	const valid = (d: unknown) => collectionSchemas.tasks.safeParse(d).success;
	let out = structuredClone(doc);
	for (const path of stringPaths(out)) {
		const last = path[path.length - 1];
		if (path[0] === "repeat" && last === "type") continue;
		const at = (n: number) => setAt(out, path, "\u0001".repeat(n));
		if (!valid(at(1))) continue;
		const limit = typeof last === "string" && /Id$/.test(last) ? 80 : 100_000;
		let lo = 1;
		let hi = 2;
		while (hi <= limit && valid(at(Math.min(hi, limit)))) {
			lo = hi;
			hi *= 2;
		}
		hi = Math.min(hi, limit + 1);
		while (hi - lo > 1) {
			const mid = Math.floor((lo + hi) / 2);
			if (valid(at(mid))) lo = mid;
			else hi = mid;
		}
		out = at(lo);
	}
	return out;
}

describe("record size budget", () => {
	test("the largest valid series of each known rule type, escapes included, stays under MAX_RECORD_BYTES", () => {
		const known = maximalDocuments().tasks.filter((doc) => {
			const type = (doc.repeat as { type?: string } | null)?.type;
			return type === "days" || type === "weeks" || type === "months" || type === "after";
		});
		expect(known).toHaveLength(4);
		for (const doc of known) {
			const repeat = doc.repeat as Record<string, unknown>;
			// Weekly rules at their most: all seven days.
			const full =
				repeat.type === "weeks"
					? { ...doc, repeat: { ...repeat, days: [0, 1, 2, 3, 4, 5, 6] } }
					: doc;
			const largest = largestTask(full);
			expect(collectionSchemas.tasks.safeParse(largest).success).toBe(true);
			expect((largest.title as string).length).toBe(280);
			expect(serializedBytes(largest)).toBeLessThan(MAX_RECORD_BYTES);
			expect(validateWireRecord(wire("tasks", largest), CHECKED_AT).ok).toBe(true);
		}
	});
});
