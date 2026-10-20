import { beforeAll, describe, expect, test } from "bun:test";
import type { Plan } from "@atomic/core";
import {
	MAX_PULL_BATCH,
	MAX_PUSH_BATCH,
	canonicalJson,
	compareVersions,
	serializedBytes,
} from "@atomic/core/sync";
import { type Config, loadConfig } from "../src/config";
import { syncUsage } from "../src/sync/service";
import {
	BASE_URL,
	type TestApp,
	type TestServer,
	bearer,
	createTestServer,
	habit,
	pull,
	pullOk,
	push,
	pushOk,
	signUp,
	task,
	trpcData,
} from "./helpers";

let app: TestApp;
let db: TestServer["db"];

beforeAll(async () => {
	({ app, db } = await createTestServer());
});

describe("authentication", () => {
	test("protected procedures answer 401 without a valid token", async () => {
		for (const token of [null, "bogus-token"]) {
			expect((await push(app, token, [task("a", 1)])).status).toBe(401);
			expect((await pull(app, token, { cursor: 0 })).status).toBe(401);
			const headers = token ? bearer(token) : undefined;
			expect((await app.request(`${BASE_URL}/trpc/me`, { headers })).status).toBe(401);
		}
		const body = (await (await pull(app, null, { cursor: 0 })).json()) as {
			error: { message: string; data: { code: string } };
		};
		expect(body.error.data.code).toBe("UNAUTHORIZED");
		expect(body.error.message).toBe("Authentication required");
	});

	test("me returns the caller", async () => {
		const { token, user, email } = await signUp(app, "Eva");
		const me = await app.request(`${BASE_URL}/trpc/me`, { headers: bearer(token) });
		expect(await trpcData(me)).toEqual({ id: user.id, email, name: "Eva" });
	});
});

describe("push / pull", () => {
	test("round trip", async () => {
		const { token } = await signUp(app);
		const records = [habit("h1", 100), task("t1", 200, { title: "Plan week", priority: 2 })];
		const pushed = await pushOk(app, token, records);
		expect(pushed).toEqual({
			accepted: 2,
			cursor: 2,
			rejected: [],
			conflicts: [],
			serverTime: expect.any(Number),
		});

		const page = await pullOk(app, token, { cursor: 0 });
		expect(page.hasMore).toBe(false);
		expect(page.cursor).toBe(2);
		expect(page.records).toEqual(records);

		expect(await pullOk(app, token, { cursor: 2 })).toEqual({
			records: [],
			cursor: 2,
			hasMore: false,
			serverTime: expect.any(Number),
		});
	});

	test("an empty push is a no-op", async () => {
		const { token } = await signUp(app);
		expect(await pushOk(app, token, [])).toEqual({
			accepted: 0,
			cursor: 0,
			rejected: [],
			conflicts: [],
			serverTime: expect.any(Number),
		});
		expect(await pullOk(app, token, { cursor: 0 })).toEqual({
			records: [],
			cursor: 0,
			hasMore: false,
			serverTime: expect.any(Number),
		});
	});

	test("the envelope's id/updatedAt/deletedAt win over the data's", async () => {
		const { token } = await signUp(app);
		const record = task("t1", 500);
		record.data = { ...record.data, id: "other", updatedAt: 1, deletedAt: 9 };
		await pushOk(app, token, [record]);
		const [stored] = (await pullOk(app, token, { cursor: 0 })).records;
		expect(stored?.data).toMatchObject({ id: "t1", updatedAt: 500, deletedAt: null });
	});

	test("unknown fields from newer clients are kept", async () => {
		const { token } = await signUp(app);
		await pushOk(app, token, [task("t1", 1, { futureField: { nested: true } })]);
		const [stored] = (await pullOk(app, token, { cursor: 0 })).records;
		expect(stored?.data.futureField).toEqual({ nested: true });
	});
});

describe("last write wins", () => {
	test("older updates and the same version are ignored, newer ones win", async () => {
		const { token } = await signUp(app);
		expect((await pushOk(app, token, [task("t1", 100, { title: "B" })])).accepted).toBe(1);

		const older = await pushOk(app, token, [task("t1", 50, { title: "A" })]);
		expect(older).toMatchObject({ accepted: 0, cursor: 1 });
		const same = await pushOk(app, token, [task("t1", 100, { title: "B" })]);
		expect(same).toMatchObject({ accepted: 0, cursor: 1, conflicts: [] });
		let page = await pullOk(app, token, { cursor: 0 });
		expect(page.records.map((r) => r.data.title)).toEqual(["B"]);

		const newer = await pushOk(app, token, [task("t1", 200, { title: "D" })]);
		expect(newer).toMatchObject({ accepted: 1, cursor: 2 });
		page = await pullOk(app, token, { cursor: 1 });
		expect(page.records).toHaveLength(1);
		expect(page.records[0]?.data.title).toBe("D");
		expect(page.cursor).toBe(2);
	});

	test("an equal updatedAt with other content is a tie broken by content, like the clients' compareVersions", async () => {
		// Two devices that edit a future-dated version both stamp `prev + 1` (D45).
		const { token } = await signUp(app);
		const b = task("t1", 100, { title: "B" });
		const a = task("t1", 100, { title: "A" });
		const c = task("t1", 100, { title: "C" });
		expect(compareVersions(c.data, b.data)).toBeGreaterThan(0);
		expect(compareVersions(a.data, b.data)).toBeLessThan(0);
		await pushOk(app, token, [b]);

		// The losing copy is not stored and comes back with the stored winner.
		const lost = await pushOk(app, token, [a]);
		expect(lost).toMatchObject({ accepted: 0, cursor: 1 });
		expect(lost.conflicts.map((r) => r.data.title)).toEqual(["B"]);
		// The winning copy replaces it, with the next sequence number, and gets no conflict.
		const won = await pushOk(app, token, [c]);
		expect(won).toMatchObject({ accepted: 1, cursor: 2, conflicts: [] });
		const page = await pullOk(app, token, { cursor: 1 });
		expect(page.records.map((r) => r.data.title)).toEqual(["C"]);
		// Within one batch, too.
		const { token: other } = await signUp(app);
		const batch = await pushOk(app, other, [b, c, a]);
		expect(batch.conflicts).toEqual([]);
		expect((await pullOk(app, other, { cursor: 0 })).records.map((r) => r.data.title)).toEqual([
			"C",
		]);
	});

	test("documents are stored as canonical JSON, so key order never decides a tie", async () => {
		const { token, user } = await signUp(app);
		const record = task("t1", 100, { title: "Same" });
		const reordered = {
			...record,
			data: Object.fromEntries(Object.entries(record.data).reverse()),
		};
		await pushOk(app, token, [record]);
		const row = await db.$client.execute({
			sql: "SELECT data FROM sync_record WHERE user_id = ? AND id = ?",
			args: [user.id, "t1"],
		});
		const stored = String(row.rows[0]?.data);
		expect(stored).toBe(canonicalJson(JSON.parse(stored)));
		expect(await pushOk(app, token, [reordered])).toMatchObject({ accepted: 0, conflicts: [] });
	});

	test("a tie with a row stored before documents were canonical is decided canonically", async () => {
		const { token, user } = await signUp(app);
		// Stored the old way: JSON.stringify in the pushed key order ("id" first).
		const legacy = task("t1", 100, { aaa: 1 });
		await pushOk(app, token, [legacy]);
		await db.$client.execute({
			sql: "UPDATE sync_record SET data = ? WHERE user_id = ? AND id = ?",
			args: [JSON.stringify(legacy.data), user.id, "t1"],
		});
		// The same version in another key order: nothing to do.
		expect(await pushOk(app, token, [legacy])).toMatchObject({ accepted: 0, conflicts: [] });
		// Canonically greater ('{"completedAt…' > '{"aaa…'), although its text is smaller
		// than the stored '{"id…': it wins, as it does on every client.
		const winner = task("t1", 100);
		expect(compareVersions(winner.data, legacy.data)).toBeGreaterThan(0);
		expect(canonicalJson(winner.data) < JSON.stringify(legacy.data)).toBe(true);
		expect(await pushOk(app, token, [winner])).toMatchObject({ accepted: 1, conflicts: [] });
		const lost = await pushOk(app, token, [legacy]);
		expect(lost).toMatchObject({ accepted: 0 });
		expect(lost.conflicts).toHaveLength(1);
		expect(lost.conflicts[0]?.data.aaa).toBeUndefined();
	});

	test("duplicates inside one batch resolve by updatedAt", async () => {
		const { token } = await signUp(app);
		const result = await pushOk(app, token, [
			task("t1", 10, { title: "first" }),
			task("t1", 30, { title: "newest" }),
			task("t1", 20, { title: "stale" }),
		]);
		expect(result.accepted).toBe(2);
		const page = await pullOk(app, token, { cursor: 0 });
		expect(page.records).toHaveLength(1);
		expect(page.records[0]?.data.title).toBe("newest");
		expect(page.cursor).toBe(result.cursor);
	});

	test("each accepted write gets the next sequence number", async () => {
		const { token } = await signUp(app);
		await pushOk(app, token, [task("a", 1), task("b", 1)]);
		await pushOk(app, token, [task("a", 2), task("c", 1), task("b", 0)]);
		const page = await pullOk(app, token, { cursor: 0 });
		// "a" moved to the end when it was rewritten; the stale "b" was ignored.
		expect(page.records.map((r) => r.id)).toEqual(["b", "a", "c"]);
		expect(page.cursor).toBe(4);
		expect((await pullOk(app, token, { cursor: 2 })).records.map((r) => r.id)).toEqual(["a", "c"]);
	});
});

describe("tombstones", () => {
	test("deletions sync and are not resurrected by older writes", async () => {
		const { token } = await signUp(app);
		await pushOk(app, token, [task("t1", 100)]);
		const deleted = await pushOk(app, token, [task("t1", 200, { deletedAt: 200 })]);
		expect(deleted.accepted).toBe(1);

		const page = await pullOk(app, token, { cursor: 1 });
		expect(page.records).toHaveLength(1);
		expect(page.records[0]).toMatchObject({ id: "t1", deletedAt: 200 });
		expect(page.records[0]?.data.deletedAt).toBe(200);

		expect((await pushOk(app, token, [task("t1", 150)])).accepted).toBe(0);
		const restored = await pushOk(app, token, [task("t1", 300)]);
		expect(restored.accepted).toBe(1);
		const latest = await pullOk(app, token, { cursor: deleted.cursor });
		expect(latest.records[0]?.deletedAt).toBeNull();
	});
});

describe("isolation", () => {
	test("users never see or overwrite each other's documents", async () => {
		const ana = await signUp(app, "Ana");
		const ben = await signUp(app, "Ben");
		await pushOk(app, ana.token, [task("shared-id", 100, { title: "Ana's" })]);
		// Same (collection, id) and an older timestamp: still a separate document.
		const benPush = await pushOk(app, ben.token, [task("shared-id", 50, { title: "Ben's" })]);
		expect(benPush).toMatchObject({ accepted: 1, cursor: 1 });
		await pushOk(app, ben.token, [habit("ben-only", 1)]);

		const anaPage = await pullOk(app, ana.token, { cursor: 0 });
		expect(anaPage.records.map((r) => r.data.title)).toEqual(["Ana's"]);
		expect(anaPage.cursor).toBe(1);

		const benPage = await pullOk(app, ben.token, { cursor: 0 });
		expect(benPage.records.map((r) => r.id)).toEqual(["shared-id", "ben-only"]);
		expect(benPage.records[0]?.data.title).toBe("Ben's");
	});
});

describe("pagination", () => {
	test("pages with hasMore until caught up", async () => {
		const { token } = await signUp(app);
		const records = Array.from({ length: 25 }, (_, i) => task(`t${i}`, i + 1));
		expect((await pushOk(app, token, records)).accepted).toBe(25);

		const seen: string[] = [];
		const pages: boolean[] = [];
		let cursor = 0;
		for (;;) {
			const page = await pullOk(app, token, { cursor, limit: 10 });
			seen.push(...page.records.map((r) => r.id));
			pages.push(page.hasMore);
			cursor = page.cursor;
			if (!page.hasMore) break;
		}
		expect(pages).toEqual([true, true, false]);
		expect(seen).toEqual(records.map((r) => r.id));
		expect(cursor).toBe(25);

		const exact = await pullOk(app, token, { cursor: 0, limit: 25 });
		expect(exact.records).toHaveLength(25);
		expect(exact.hasMore).toBe(false);
	});

	test("defaults to 500 records per page", async () => {
		const { token } = await signUp(app);
		const records = Array.from({ length: MAX_PUSH_BATCH }, (_, i) => task(`a${i}`, 1));
		await pushOk(app, token, records);
		await pushOk(app, token, [task("last", 1)]);
		const first = await pullOk(app, token, { cursor: 0 });
		expect(first.records).toHaveLength(500);
		expect(first.hasMore).toBe(true);
		const second = await pullOk(app, token, { cursor: first.cursor });
		expect(second.records.map((r) => r.id)).toEqual(["last"]);
		expect(second.hasMore).toBe(false);
	});

	test("limits above MAX_PULL_BATCH are rejected", async () => {
		const { token } = await signUp(app);
		expect((await pull(app, token, { cursor: 0, limit: MAX_PULL_BATCH + 1 })).status).toBe(400);
		expect((await pull(app, token, { cursor: -1 })).status).toBe(400);
	});
});

describe("validation", () => {
	test("invalid records are rejected; valid ones in the same batch are stored", async () => {
		const { token } = await signUp(app);
		const result = await pushOk(app, token, [
			task("ok-1", 1),
			habit("no-name", 1, { name: undefined }),
			habit("bad-color", 1, { color: "chartreuse" }),
			habit("bad-date", 1, { startDate: "yesterday" }),
			task("too-long", 1, { title: "x".repeat(281) }),
			{ collection: "logs", id: "bad-log", updatedAt: 1, deletedAt: null, data: { count: -1 } },
			habit("ok-2", 1),
		]);
		expect(result.accepted).toBe(2);
		expect(result.cursor).toBe(2);
		expect(result.rejected.map((r) => r.id)).toEqual([
			"no-name",
			"bad-color",
			"bad-date",
			"too-long",
			"bad-log",
		]);
		expect(result.rejected[1]?.reason).toContain("color");

		const page = await pullOk(app, token, { cursor: 0 });
		expect(page.records.map((r) => r.id)).toEqual(["ok-1", "ok-2"]);
	});

	test("malformed requests fail as a whole with 400", async () => {
		const { token } = await signUp(app);
		const malformed: unknown[][] = [
			// Not a collection name at all (a well-formed unknown name is rejected per record).
			[{ ...task("a", 1), collection: "../secrets" }],
			[{ ...task("a", 1), collection: "Tasks" }],
			[{ collection: "tasks", id: "a", deletedAt: null, data: {} }],
			[{ ...task("a", 1), id: "" }],
			Array.from({ length: MAX_PUSH_BATCH + 1 }, (_, i) => task(`t${i}`, 1)),
		];
		for (const records of malformed) {
			expect((await push(app, token, records)).status).toBe(400);
		}
		expect((await pullOk(app, token, { cursor: 0 })).records).toHaveLength(0);
	});
});

describe("hardening", () => {
	test("a push that loses last-write-wins gets the stored winner back", async () => {
		const { token } = await signUp(app);
		await pushOk(app, token, [task("t1", 500, { title: "Newer" })]);
		const result = await pushOk(app, token, [task("t1", 100, { title: "Older" })]);
		expect(result.accepted).toBe(0);
		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]?.updatedAt).toBe(500);
		expect(result.conflicts[0]?.data.title).toBe("Newer");
	});

	test("a cursor ahead of the server asks the device to start over", async () => {
		const { token } = await signUp(app);
		await pushOk(app, token, [task("t1", 1)]);
		expect(await pullOk(app, token, { cursor: 99 })).toEqual({
			records: [],
			cursor: 0,
			hasMore: false,
			reset: true,
			serverTime: expect.any(Number),
		});
		expect((await pullOk(app, token, { cursor: 1 })).reset).toBeUndefined();
	});

	test("oversized records are rejected, the rest of the batch is stored", async () => {
		const { token } = await signUp(app);
		const huge = task("big", 1, { notes: "x".repeat(70_000) });
		const result = await pushOk(app, token, [huge, task("ok", 1)]);
		expect(result.accepted).toBe(1);
		expect(result.rejected.map((r) => r.id)).toEqual(["big"]);
	});

	test("tRPC batching is disabled", async () => {
		const { token } = await signUp(app);
		const input = encodeURIComponent(JSON.stringify({ 0: { cursor: 0 }, 1: { cursor: 0 } }));
		const response = await app.request(
			`${BASE_URL}/trpc/sync.pull,sync.pull?batch=1&input=${input}`,
			{ headers: bearer(token) },
		);
		expect(response.status).toBe(400);
	});

	test("unsafe timestamps are refused before they reach the database", async () => {
		const { token } = await signUp(app);
		const response = await push(app, token, [task("t1", 2 ** 60)]);
		expect(response.status).toBe(400);
	});
});

describe("protocol v2 (spec §2.7, §4.6)", () => {
	test("an unknown collection is rejected per record with unknown-collection; the rest is stored", async () => {
		const { token } = await signUp(app);
		const future = { ...task("f1", 1), collection: "gardenBeds" };
		const result = await pushOk(app, token, [future, task("ok", 1)]);
		expect(result.accepted).toBe(1);
		expect(result.rejected).toEqual([
			{
				collection: "gardenBeds",
				id: "f1",
				reason: "collection: unknown-collection",
				code: "unknown-collection",
			},
		]);
		const page = await pullOk(app, token, { cursor: 0 });
		expect(page.records.map((r) => `${r.collection}/${r.id}`)).toEqual(["tasks/ok"]);
	});

	test("camelCase v2 collections are accepted", async () => {
		const { token } = await signUp(app);
		const log = {
			collection: "taskLogs",
			id: "t1:2026-10-17",
			updatedAt: 5,
			deletedAt: null,
			data: {
				id: "t1:2026-10-17",
				createdAt: 5,
				updatedAt: 5,
				taskId: "t1",
				date: "2026-10-17",
				status: "done",
				resolvedOn: "2026-10-17",
			},
		};
		const result = await pushOk(app, token, [log]);
		expect(result).toMatchObject({ accepted: 1, rejected: [] });
		expect((await pullOk(app, token, { cursor: 0 })).records[0]?.collection).toBe("taskLogs");
	});

	test("updatedAt more than 10 minutes ahead is rejected with future-timestamp", async () => {
		const { token } = await signUp(app);
		const now = Date.now();
		const result = await pushOk(app, token, [
			task("ahead", now + 11 * 60_000),
			task("skewed", now + 5 * 60_000),
		]);
		expect(result.accepted).toBe(1);
		expect(result.rejected).toEqual([
			{
				collection: "tasks",
				id: "ahead",
				reason: "updatedAt: future-timestamp",
				code: "future-timestamp",
			},
		]);
	});

	test("rejections carry a code and a content-free reason", async () => {
		const { token } = await signUp(app);
		const secret = "my-secret-title-canary";
		const result = await pushOk(app, token, [
			task("bad", 1, { priority: secret }),
			task("big", 1, { notes: secret.repeat(4_000) }),
		]);
		expect(result.rejected.map((r) => [r.id, r.code])).toEqual([
			["bad", "invalid"],
			["big", "too-large"],
		]);
		expect(result.rejected[0]?.reason).toBe("priority: invalid_union");
		expect(JSON.stringify(result.rejected)).not.toContain(secret);
	});

	test("push and pull answer with the server clock", async () => {
		const { token } = await signUp(app);
		const before = Date.now();
		const pushed = await pushOk(app, token, [task("t1", 1)]);
		const pulled = await pullOk(app, token, { cursor: 0 });
		const after = Date.now();
		for (const serverTime of [pushed.serverTime, pulled.serverTime]) {
			expect(serverTime).toBeGreaterThanOrEqual(before);
			expect(serverTime).toBeLessThanOrEqual(after);
		}
	});
});

/** The default plans with every plan's sync storage set to `syncBytes`. */
function plansWith(
	syncBytes: Partial<Record<Plan, number>>,
	defaultPlan: Plan = "pro",
): Config["plans"] {
	const { limits } = loadConfig({ NODE_ENV: "test" }).plans;
	return {
		defaultPlan,
		limits: {
			free: { ...limits.free, syncBytes: syncBytes.free ?? limits.free.syncBytes },
			pro: { ...limits.pro, syncBytes: syncBytes.pro ?? limits.pro.syncBytes },
		},
	};
}

/** A task whose stored JSON is about `bytes` long. */
const sized = (id: string, updatedAt: number, bytes: number, patch: Record<string, unknown> = {}) =>
	task(id, updatedAt, { notes: "n".repeat(Math.max(0, bytes - 200)), ...patch });

describe("sync quota (spec §4.5, D54)", () => {
	const LIMIT = 2_000;
	let quota: TestServer;

	beforeAll(async () => {
		quota = await createTestServer({ config: { plans: plansWith({ pro: LIMIT }) } });
	});

	test("usage is the UTF-8 size of the stored documents, through inserts, updates and tombstones", async () => {
		const { token, user } = await signUp(app);
		await pushOk(app, token, [
			task("a", 1, { title: "Ler à noite 📚" }),
			task("b", 1, { notes: "x".repeat(500) }),
			habit("h", 1),
		]);
		await pushOk(app, token, [
			task("a", 2, { title: "Ler à noite 📚📚📚", notes: "ç".repeat(40) }),
			task("b", 2, { notes: "short" }),
			habit("h", 2, { deletedAt: 2 }),
		]);
		const { records } = await pullOk(app, token, { cursor: 0 });
		const expected = records.reduce((sum, r) => sum + serializedBytes(r.data), 0);
		expect(expected).toBeGreaterThan(0);
		expect(await syncUsage(db, user.id)).toBe(expected);
	});

	test("a write past the limit is refused with quota; the rest of the batch is stored", async () => {
		const { token, user } = await signUp(quota.app);
		expect(await pushOk(quota.app, token, [sized("a", 1, 700), sized("b", 1, 700)])).toMatchObject({
			accepted: 2,
			rejected: [],
		});
		const used = await syncUsage(quota.db, user.id);
		const result = await pushOk(quota.app, token, [
			habit("small-1", 1),
			sized("c", 1, 700),
			habit("small-2", 1),
		]);
		expect(result.accepted).toBe(2);
		expect(result.rejected).toEqual([
			{ collection: "tasks", id: "c", reason: "$: quota", code: "quota" },
		]);
		expect(result.conflicts).toEqual([]);
		const ids = (await pullOk(quota.app, token, { cursor: 0 })).records.map((r) => r.id);
		expect(ids).toEqual(["a", "b", "small-1", "small-2"]);
		expect(await syncUsage(quota.db, user.id)).toBeGreaterThan(used);
		expect(await syncUsage(quota.db, user.id)).toBeLessThanOrEqual(LIMIT);
	});

	test("tombstones are always accepted, even over the quota; growing writes are not", async () => {
		const { token, user } = await signUp(quota.app);
		await pushOk(quota.app, token, [sized("a", 1, 900), sized("b", 1, 900)]);
		// A deletion keeps the full entity (no compaction in v2), so it can grow the usage.
		const deleted = await pushOk(quota.app, token, [
			sized("gone", 5, 1500, { deletedAt: 5 }),
			sized("a", 5, 1500, { deletedAt: 5 }),
		]);
		expect(deleted).toMatchObject({ accepted: 2, rejected: [] });
		expect(await syncUsage(quota.db, user.id)).toBeGreaterThan(LIMIT);
		// Over the quota: growing (or new) documents are refused…
		const grow = await pushOk(quota.app, token, [sized("b", 6, 1200), habit("new", 6)]);
		expect(grow.rejected.map((r) => [r.id, r.code])).toEqual([
			["b", "quota"],
			["new", "quota"],
		]);
		expect(grow.accepted).toBe(0);
		// …while edits that don't grow are accepted, so the user can trim.
		const trim = await pushOk(quota.app, token, [sized("b", 7, 300)]);
		expect(trim).toMatchObject({ accepted: 1, rejected: [] });
	});

	test("a refused record is accepted once there is room (the client keeps it pending)", async () => {
		const { token } = await signUp(quota.app);
		await pushOk(quota.app, token, [sized("a", 1, 1500)]);
		const refused = await pushOk(quota.app, token, [sized("c", 1, 700)]);
		expect(refused.rejected.map((r) => r.code)).toEqual(["quota"]);
		await pushOk(quota.app, token, [sized("a", 2, 400)]);
		expect(await pushOk(quota.app, token, [sized("c", 1, 700)])).toMatchObject({
			accepted: 1,
			rejected: [],
		});
	});

	test("a refused record that also lost last-write-wins comes back as a conflict, not quota", async () => {
		const { token } = await signUp(quota.app);
		await pushOk(quota.app, token, [sized("a", 500, 300), sized("filler", 1, 1600)]);
		const result = await pushOk(quota.app, token, [sized("a", 100, 1200)]);
		expect(result.rejected).toEqual([]);
		expect(result.conflicts.map((r) => [r.id, r.updatedAt])).toEqual([["a", 500]]);
	});

	test("the limit is the user's plan's (DEFAULT_PLAN without billing)", async () => {
		const free = await createTestServer({
			config: { plans: plansWith({ free: 1_000, pro: 1_000_000 }, "free") },
		});
		const { token } = await signUp(free.app);
		const result = await pushOk(free.app, token, [sized("a", 1, 700), sized("b", 1, 700)]);
		expect(result.rejected.map((r) => [r.id, r.code])).toEqual([["b", "quota"]]);
	});
});

describe("push rate limit (D54)", () => {
	test("past 60 pushes a minute a user gets 429 with Retry-After; others are unaffected", async () => {
		let t = Date.now();
		const limited = await createTestServer({ deps: { now: () => t } });
		const ana = await signUp(limited.app, "Ana");
		const ben = await signUp(limited.app, "Ben");
		for (let i = 0; i < 60; i++) {
			expect((await push(limited.app, ana.token, [task(`t${i}`, i + 1)])).status).toBe(200);
		}
		t += 20_000;
		const response = await push(limited.app, ana.token, [task("late", 1)]);
		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("40");
		const body = (await response.json()) as {
			error: { data: { code: string; atomic?: { reason: string; retryAt: number } } };
		};
		expect(body.error.data.code).toBe("TOO_MANY_REQUESTS");
		expect(body.error.data.atomic?.reason).toBe("rate");

		// Nothing was stored; pulls and other users still work.
		const page = await pullOk(limited.app, ana.token, { cursor: 0 });
		expect(page.records.map((r) => r.id)).not.toContain("late");
		expect((await push(limited.app, ben.token, [task("b", 1)])).status).toBe(200);

		// The next window.
		t += 40_000;
		expect(await pushOk(limited.app, ana.token, [task("late", 1)])).toMatchObject({ accepted: 1 });
	});

	test("malformed pushes count too", async () => {
		let t = Date.now();
		const limited = await createTestServer({ deps: { now: () => t } });
		const { token } = await signUp(limited.app);
		for (let i = 0; i < 60; i++) {
			expect((await push(limited.app, token, [{ nonsense: true }])).status).toBe(400);
		}
		expect((await push(limited.app, token, [task("a", 1)])).status).toBe(429);
		t += 60_000;
		expect((await push(limited.app, token, [task("a", 1)])).status).toBe(200);
	});
});
