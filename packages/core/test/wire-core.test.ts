import { describe, expect, test } from "bun:test";
import { COLLECTIONS, type Collection, collectionSchemas } from "../src/model";
import {
	COLLECTION_RE,
	KEEP_PENDING_CODES,
	MAX_FUTURE_MS,
	MAX_PUSH_BATCH,
	MAX_RECORD_BYTES,
	REJECT_CODES,
	type WireSyncRecord,
	parsePendingKey,
	pendingKey,
	pullOutputSchema,
	pushInputSchema,
	pushOutputSchema,
	rejectedRecordSchema,
	serializedBytes,
	syncRecordSchema,
	validateWireRecord,
	wireSyncRecordSchema,
} from "../src/sync";
import { maximalDocuments } from "./support/v2-documents";

/**
 * The wire contract shared by clients and the server (spec §2.7, D2, D51):
 * collection names, schemas, `serializedBytes` and `validateWireRecord`.
 * Per-collection validation cases of the new collections live with their
 * tracks (`wire-tasks`, `wire-journal`, `wire-trackers`, spec §4.6).
 */

const NOW = 1_790_000_000_000;

const record = (
	collection: string,
	data: Record<string, unknown>,
	envelope: Partial<WireSyncRecord> = {},
): WireSyncRecord => ({
	collection,
	id: (data.id as string) ?? "x",
	updatedAt: (data.updatedAt as number) ?? 1,
	deletedAt: (data.deletedAt as number | null) ?? null,
	data,
	...envelope,
});

const task = (extra: Record<string, unknown> = {}) => ({
	id: "t1",
	createdAt: 1,
	updatedAt: 2,
	deletedAt: null,
	title: "Plan the week",
	...extra,
});

const utf8 = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length;

describe("collection names (D2)", () => {
	test("COLLECTION_RE takes camelCase names: every known collection and future ones", () => {
		for (const name of [...COLLECTIONS, "gardenBeds", "x", `a${"b".repeat(39)}`, "v3Things"]) {
			expect(COLLECTION_RE.test(name)).toBe(true);
		}
		for (const name of [
			"",
			"Tasks",
			"3d",
			"task-logs",
			"tasks/x",
			"../x",
			`a${"b".repeat(40)}`,
			"täsks",
		]) {
			expect(COLLECTION_RE.test(name)).toBe(false);
		}
	});

	test("the wire record takes any well-formed collection; the typed (v1) record only known ones", () => {
		const future = record("gardenBeds", { id: "b1" });
		expect(wireSyncRecordSchema.safeParse(future).success).toBe(true);
		expect(syncRecordSchema.safeParse(future).success).toBe(false);
		expect(wireSyncRecordSchema.safeParse({ ...future, collection: "Garden Beds" }).success).toBe(
			false,
		);
		expect(pushInputSchema.safeParse({ records: [future] }).success).toBe(true);
		const many = Array.from({ length: MAX_PUSH_BATCH + 1 }, () => future);
		expect(pushInputSchema.safeParse({ records: many }).success).toBe(false);
	});

	test("pending keys parse only for known collections; ids may contain slashes", () => {
		expect(pendingKey("taskLogs", "t1:2026-10-17")).toBe("taskLogs/t1:2026-10-17");
		expect(parsePendingKey("tasks/a/b")).toEqual({ collection: "tasks", id: "a/b" });
		expect(parsePendingKey("gardenBeds/b1")).toBeNull();
		expect(parsePendingKey("tasks")).toBeNull();
	});
});

describe("wire outputs", () => {
	test("v1 outputs still parse; v2 adds serverTime, codes and string collections", () => {
		expect(pushOutputSchema.safeParse({ accepted: 1, cursor: 2 }).success).toBe(true);
		expect(pullOutputSchema.safeParse({ records: [], cursor: 0, hasMore: false }).success).toBe(
			true,
		);
		const v2 = pushOutputSchema.parse({
			accepted: 0,
			cursor: 2,
			rejected: [{ collection: "gardenBeds", id: "b1", reason: "x", code: "unknown-collection" }],
			conflicts: [record("taskLogs", { id: "t1:2026-10-17" })],
			serverTime: NOW,
		});
		expect(v2.serverTime).toBe(NOW);
		expect(
			pullOutputSchema.parse({ records: [], cursor: 0, hasMore: false, serverTime: NOW }),
		).toMatchObject({ serverTime: NOW });
		// A v1 server's rejection has no code.
		expect(
			rejectedRecordSchema.safeParse({ collection: "tasks", id: "a", reason: "r" }).success,
		).toBe(true);
		expect(REJECT_CODES).toEqual([
			"invalid",
			"too-large",
			"unknown-collection",
			"future-timestamp",
			"quota",
		]);
		expect(KEEP_PENDING_CODES).toEqual(["unknown-collection", "future-timestamp", "quota"]);
	});
});

describe("serializedBytes", () => {
	test("is the UTF-8 length of the JSON, matching TextEncoder", () => {
		const samples: unknown[] = [
			"plain ascii",
			"ação e café",
			"漢字かな交じり文",
			"🌱🚫📚 emoji with 👩‍👩‍👧 ZWJ",
			'quotes " and \\ backslashes\n\ttabs',
			"control \u0001\u001f chars",
			"lone \ud800 high and \udc00 low surrogates",
			{ nested: { list: [1, "ç", null, true], deep: { "chave ç": "🌍" } } },
			12.5,
			null,
			[],
		];
		for (const sample of samples) expect(serializedBytes(sample)).toBe(utf8(sample));
		expect(serializedBytes(undefined)).toBe(0);
		// UTF-16 length undercounts: 3 bytes per CJK unit, 2 per emoji unit.
		expect(serializedBytes("漢")).toBe(5);
		expect(serializedBytes("🌱")).toBe(6);
	});
});

describe("validateWireRecord (D51)", () => {
	test("accepts a valid record and returns the merged data, unknown fields kept and defaults not added", () => {
		const check = validateWireRecord(
			record("tasks", task({ futureField: { nested: 1 } }), { updatedAt: 9 }),
			NOW,
		);
		expect(check).toEqual({
			ok: true,
			data: { ...task({ futureField: { nested: 1 } }), updatedAt: 9 },
		});
	});

	test("the envelope's id/updatedAt/deletedAt win over the data's", () => {
		const check = validateWireRecord(
			record("tasks", task({ id: "other", updatedAt: 1, deletedAt: 5 }), {
				id: "t1",
				updatedAt: 7,
				deletedAt: null,
			}),
			NOW,
		);
		expect(check.ok && check.data).toMatchObject({ id: "t1", updatedAt: 7, deletedAt: null });
	});

	test("checks run in order: unknown-collection → too-large → future-timestamp → schema", () => {
		const huge = "x".repeat(MAX_RECORD_BYTES);
		const bad = { title: 5, notes: huge };
		const future = { updatedAt: NOW + MAX_FUTURE_MS + 1 };
		expect(validateWireRecord(record("gardenBeds", task(bad), future), NOW)).toMatchObject({
			ok: false,
			code: "unknown-collection",
		});
		expect(validateWireRecord(record("tasks", task(bad), future), NOW)).toMatchObject({
			ok: false,
			code: "too-large",
		});
		expect(validateWireRecord(record("tasks", task({ title: 5 }), future), NOW)).toMatchObject({
			ok: false,
			code: "future-timestamp",
		});
		expect(validateWireRecord(record("tasks", task({ title: 5 })), NOW)).toMatchObject({
			ok: false,
			code: "invalid",
		});
	});

	test("the reason is `${path}: ${issue.code}`: never a zod message, never a value", () => {
		const canary = "canary-secret-7731";
		const cases: [string, Record<string, unknown>, string][] = [
			["tasks", task({ title: canary.repeat(20) }), "title: too_big"],
			["tasks", task({ priority: canary }), "priority: invalid_union"],
			[
				"habits",
				{ id: "h", createdAt: 1, updatedAt: 1, name: canary, color: canary },
				"color: invalid_value",
			],
			["tasks", task({ repeat: { type: "days", every: canary } }), "repeat: custom"],
			["logs", { id: "l", createdAt: 1, updatedAt: 1, habitId: "h", date: canary }, "date: custom"],
		];
		for (const [collection, data, reason] of cases) {
			const check = validateWireRecord(record(collection, data), NOW);
			expect(check).toEqual({ ok: false, code: "invalid", reason });
			expect(JSON.stringify(check)).not.toContain("canary");
		}
		const root = validateWireRecord(
			{ collection: "tasks", id: "t", updatedAt: 1, deletedAt: null, data: { title: "x" } },
			NOW,
		);
		expect(root.ok).toBe(false);
		expect(!root.ok && root.reason).toMatch(/^[A-Za-z.$0-9]+: [a-z_]+$/);
	});

	test("future timestamps: up to MAX_FUTURE_MS (10 min) ahead is accepted, beyond is rejected", () => {
		expect(MAX_FUTURE_MS).toBe(10 * 60 * 1000);
		const at = (updatedAt: number) =>
			validateWireRecord(record("tasks", task(), { updatedAt }), NOW);
		expect(at(NOW + MAX_FUTURE_MS).ok).toBe(true);
		expect(at(NOW + MAX_FUTURE_MS + 1)).toEqual({
			ok: false,
			code: "future-timestamp",
			reason: "updatedAt: future-timestamp",
		});
	});

	test("size is measured in UTF-8 bytes of the merged record", () => {
		const base = serializedBytes({ ...task(), extra: "" });
		const fits = MAX_RECORD_BYTES - base;
		const ascii = (n: number) => record("tasks", task({ extra: "a".repeat(n) }), { updatedAt: 2 });
		expect(validateWireRecord(ascii(fits), NOW).ok).toBe(true);
		expect(validateWireRecord(ascii(fits + 1), NOW)).toMatchObject({ code: "too-large" });
		// 22,000 CJK characters: 22,000 UTF-16 units (v1 accepted them), 66,000 bytes.
		const cjk = record("tasks", task({ extra: "漢".repeat(22_000) }));
		expect(JSON.stringify(cjk.data).length).toBeLessThan(MAX_RECORD_BYTES);
		expect(validateWireRecord(cjk, NOW)).toMatchObject({ ok: false, code: "too-large" });
	});

	test("every collection validates with its own schema, tombstones included", () => {
		const docs = maximalDocuments();
		for (const collection of COLLECTIONS) {
			for (const doc of docs[collection]) {
				const check = validateWireRecord(record(collection, doc), NOW);
				expect(check.ok).toBe(true);
				const tombstone = validateWireRecord(
					record(collection, { ...doc, deletedAt: 5 }, { deletedAt: 5 }),
					NOW,
				);
				expect(tombstone.ok).toBe(true);
			}
		}
		const log = {
			id: "t1:2026-10-17",
			createdAt: 1,
			updatedAt: 1,
			taskId: "t1",
			date: "2026-10-17",
			resolvedOn: "2026-10-17",
		};
		expect(validateWireRecord(record("taskLogs", log), NOW).ok).toBe(true);
		expect(validateWireRecord(record("taskLogs", { ...log, status: "maybe" }), NOW)).toEqual({
			ok: false,
			code: "invalid",
			reason: "status: invalid_value",
		});
	});
});

// ── The largest valid document stays under MAX_RECORD_BYTES ──

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
 * Every string set to its longest valid value made of `\u0001`, the worst
 * case for JSON (6 bytes per UTF-16 unit), and `goalHistory` filled to its
 * maximum. Strings with a format (days, times) keep their value. Link ids
 * (`habitId`, `identityId`) are ids: at most 80 characters (spec §2.1). The
 * v1 schemas don't bound them; the wire's `too-large` check does.
 */
function largest(collection: Collection, doc: Record<string, unknown>): Record<string, unknown> {
	const schema = collectionSchemas[collection];
	const valid = (d: unknown) => schema.safeParse(d).success;
	let out = structuredClone(doc);
	const history = out.goalHistory;
	if (Array.isArray(history) && history.length) {
		const filled = { ...out, goalHistory: Array.from({ length: 48 }, () => history[0]) };
		if (valid(filled)) out = filled;
	}
	for (const path of stringPaths(out)) {
		const at = (n: number) => setAt(out, path, "\u0001".repeat(n));
		if (!valid(at(1))) continue;
		const last = path[path.length - 1];
		const limit = typeof last === "string" && /Id$/.test(last) ? 80 : 1_000_000;
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
	test("the largest valid document of each F-owned collection, escapes included, stays under MAX_RECORD_BYTES", () => {
		const docs = maximalDocuments();
		// Tracker configs, journal entries and translations are covered by their tracks (§4.6).
		const owned: Collection[] = ["habits", "logs", "tasks", "identities", "scorecard", "taskLogs"];
		for (const collection of owned) {
			const plain =
				(docs[collection] ?? []).filter((d) => d.tracker == null)[0] ?? docs[collection][0];
			expect(plain).toBeDefined();
			const doc = largest(collection, plain as Record<string, unknown>);
			expect(collectionSchemas[collection].safeParse(doc).success).toBe(true);
			const bytes = serializedBytes(doc);
			expect(bytes).toBeLessThan(MAX_RECORD_BYTES);
			expect(validateWireRecord(record(collection, doc), NOW).ok).toBe(true);
		}
	});
});
