import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	AI_SUGGEST_KINDS,
	type AccountInfo,
	aiSuggestRequestSchema,
	aiTranslateRequestSchema,
} from "@atomic/core";
import { erasureHash, erasureLogPath, readErasures } from "../src/account/erasures";
import {
	guessLanguage,
	runAiEval,
	suggestCases,
	summarize,
	translateCases,
} from "../src/admin/ai-eval";
import { BackupError, pruneSnapshots, snapshotDatabase, snapshotName } from "../src/admin/backup";
import {
	GrantError,
	grantPlan,
	listGrants,
	parseDuration,
	parsePlan,
	revokeGrants,
} from "../src/admin/grant";
import { restoreCheck } from "../src/admin/restore-check";
import { createOpenAICompatibleProvider } from "../src/ai/provider";
import { createBlobStorage } from "../src/blobs/storage";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db";
import { SYNC_EPOCH_SIZE } from "../src/sync/service";
import { BILLING_ENV, type FakeAi, createFakeStripe, startFakeAi } from "./fakes";
import {
	BASE_URL,
	TEST_SECRET,
	type TestServer,
	bearer,
	createTestServer,
	postJson,
	pullOk,
	pushOk,
	scratchDir,
	signUp,
	task,
	testEnv,
	trpcData,
} from "./helpers";

/**
 * Operator tools (spec §4.5 "Scripts", §4.7): plan grants, database
 * snapshots, the restore check (with an automated restore drill), and the
 * AI evaluation, plus smoke runs of the real `scripts/*.ts` entry points.
 */

const DAY = 86_400_000;
const SERVER_DIR = join(import.meta.dir, "..");

async function accountOf(server: TestServer, token: string): Promise<AccountInfo> {
	return trpcData<AccountInfo>(
		await server.app.request(`${BASE_URL}/trpc/account.get`, { headers: bearer(token) }),
	);
}

function jpeg(seed: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(seed)]);
}

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Runs one of the real scripts against `env` (never `process.env`'s database). */
async function script(name: string, args: string[], env: Record<string, string | undefined>) {
	const proc = Bun.spawn(["bun", "run", `scripts/${name}.ts`, ...args], {
		cwd: SERVER_DIR,
		env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

describe("plan grants", () => {
	let server: TestServer;
	let clock = 0;

	beforeAll(async () => {
		server = await createTestServer({
			env: BILLING_ENV,
			deps: { stripe: createFakeStripe(), now: () => Date.now() + clock },
		});
	});

	test("durations and plans", () => {
		expect(parseDuration("90d")).toBe(90 * DAY);
		expect(parseDuration("2w")).toBe(14 * DAY);
		expect(parseDuration("48h")).toBe(2 * DAY);
		expect(parseDuration("forever")).toBeNull();
		for (const bad of ["", "90", "0d", "3651d", "1y", "-5d", "1.5d"]) {
			expect(() => parseDuration(bad)).toThrow(GrantError);
		}
		expect(parsePlan("PRO")).toBe("pro");
		expect(() => parsePlan("gold")).toThrow(GrantError);
	});

	test("a grant makes the user Pro until it ends; revoking ends it now", async () => {
		const owner = await signUp(server.app, "Beta");
		expect((await accountOf(server, owner.token)).entitlements.plan).toBe("free");
		const now = Date.now() + clock;
		const result = await grantPlan(server.db, {
			email: owner.email.toUpperCase(),
			plan: "pro",
			durationMs: 90 * DAY,
			reason: "beta tester",
			now,
		});
		expect(result).toMatchObject({ userId: owner.user.id, expiresAt: now + 90 * DAY });
		clock += 61_000; // the server's 60 s plan cache
		expect((await accountOf(server, owner.token)).entitlements).toMatchObject({
			plan: "pro",
			source: "grant",
			endsAt: now + 90 * DAY,
		});
		const rows = await listGrants(server.db, owner.email, Date.now() + clock);
		expect(rows).toEqual([
			expect.objectContaining({ plan: "pro", reason: "beta tester", active: true }),
		]);

		expect(await revokeGrants(server.db, owner.email, Date.now() + clock)).toBe(1);
		clock += 61_000;
		expect((await accountOf(server, owner.token)).entitlements.plan).toBe("free");
		expect((await listGrants(server.db, owner.email, Date.now() + clock))[0]?.active).toBe(false);
		expect(await revokeGrants(server.db, owner.email, Date.now() + clock)).toBe(0);
	});

	test("refusals: unknown account, missing or long reason", async () => {
		const owner = await signUp(server.app, "Refused");
		const input = { plan: "pro" as const, durationMs: null, now: Date.now() };
		await expect(
			grantPlan(server.db, { ...input, email: "nobody@example.com", reason: "x" }),
		).rejects.toThrow("No account with that email");
		await expect(
			grantPlan(server.db, { ...input, email: owner.email, reason: "  " }),
		).rejects.toThrow(GrantError);
		await expect(
			grantPlan(server.db, { ...input, email: owner.email, reason: "x".repeat(201) }),
		).rejects.toThrow(GrantError);
	});

	test("scripts/grant.ts: grant, list, revoke and usage errors", async () => {
		const owner = await signUp(server.app, "Cli");
		const env = { DATABASE_URL: server.config.databaseUrl, BETTER_AUTH_SECRET: TEST_SECRET };
		const granted = await script("grant", [owner.email, "pro", "30d", "support gesture"], env);
		expect(granted.code).toBe(0);
		expect(granted.stdout).toContain("Granted pro until");
		const listed = await script("grant", ["--list", owner.email], env);
		expect(listed.stdout).toContain("active  pro");
		expect(listed.stdout).toContain("support gesture");
		const revoked = await script("grant", ["--revoke", owner.email], env);
		expect(revoked.stdout).toContain("Ended 1 active grant(s)");
		const unknown = await script("grant", ["nobody@example.com", "pro", "30d", "x"], env);
		expect(unknown.code).toBe(1);
		expect(unknown.stderr).toContain("No account with that email");
		const usage = await script("grant", [owner.email, "pro"], env);
		expect(usage.code).toBe(2);
		expect(usage.stderr).toContain("usage:");
	});
});

describe("snapshots and the restore drill", () => {
	let server: TestServer;
	let owner: Awaited<ReturnType<typeof signUp>>;
	let dir: string;
	let photo: Uint8Array<ArrayBuffer>;

	beforeAll(async () => {
		server = await createTestServer();
		owner = await signUp(server.app, "Drill");
		await pushOk(server.app, owner.token, [task("a", Date.now()), task("b", Date.now())]);
		photo = jpeg("drill photo");
		const put = await server.app.request(`${BASE_URL}/blobs/${sha256(photo)}`, {
			method: "PUT",
			headers: bearer(owner.token),
			body: photo,
		});
		expect(put.status).toBe(201);
		dir = scratchDir();
	});

	test("names sort by time and never contain colons", () => {
		const a = snapshotName(Date.parse("2026-10-20T09:05:03.120Z"));
		expect(a).toBe("atomic-2026-10-20T09-05-03Z.db");
		expect(snapshotName(Date.parse("2026-10-20T10:00:00Z")) > a).toBe(true);
	});

	test("a snapshot taken while the server runs is a complete, checked database", async () => {
		const snapshot = await snapshotDatabase(
			server.db,
			server.config.databaseUrl,
			join(dir, "backups"),
			Date.now(),
		);
		expect(existsSync(snapshot.path)).toBe(true);
		expect(snapshot).toMatchObject({ users: 1, records: 2 });
		expect(snapshot.bytes).toBeGreaterThan(0);
		// The server keeps working after it.
		await pushOk(server.app, owner.token, [task("c", Date.now())]);

		// Restore drill: a fresh server on the copy (photos restored alongside).
		const restoredDir = scratchDir();
		const db = join(restoredDir, "atomic.db");
		await Bun.write(db, Bun.file(snapshot.path));
		const restored = await createTestServer({
			env: {
				DATABASE_URL: `file:${db}`,
				// Photos restored alongside the database: the same directory.
				BLOB_DIR: (server.config.blobs as { dir: string }).dir,
			},
		});
		const report = await restoreCheck(restored.db, {
			storage: restored.server.services.storage,
			fix: false,
			local: true,
		});
		expect(report).toMatchObject({
			integrity: "ok",
			users: 1,
			records: 2,
			cursorsBehind: 0,
			bytesDrift: 0,
			blobRows: 1,
			missingObjects: 0,
			problems: [],
		});
		expect(report.migrations.applied).toBe(report.migrations.shipped);
		// The same password signs in, and the documents of the snapshot come back.
		const signIn = await postJson(restored.app, "/api/auth/sign-in/email", {
			email: owner.email,
			password: owner.password,
		});
		expect(signIn.status).toBe(200);
		const token = signIn.headers.get("set-auth-token") ?? "";
		const pulled = await pullOk(restored.app, token, { cursor: 0, limit: 100 });
		expect(pulled.records.map((r) => r.id).sort()).toEqual(["a", "b"]);
		const got = await restored.app.request(`${BASE_URL}/blobs/${sha256(photo)}`, {
			headers: bearer(token),
		});
		expect(new Uint8Array(await got.arrayBuffer())).toEqual(photo);
	});

	test("pruneSnapshots keeps the newest N", async () => {
		const backups = join(dir, "prune");
		for (const at of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]) {
			await snapshotDatabase(server.db, server.config.databaseUrl, backups, Date.parse(at));
		}
		writeFileSync(join(backups, "notes.txt"), "kept");
		expect(await pruneSnapshots(backups, 2)).toEqual([
			"atomic-2026-10-01T00-00-00Z.db",
			"atomic-2026-10-02T00-00-00Z.db",
		]);
		expect(readdirSync(backups).sort()).toEqual([
			"atomic-2026-10-03T00-00-00Z.db",
			"atomic-2026-10-04T00-00-00Z.db",
			"notes.txt",
		]);
	});

	test("remote databases (Turso) are refused with a pointer to their own backups", async () => {
		await expect(
			snapshotDatabase(server.db, "libsql://atomic-org.turso.io", dir, Date.now()),
		).rejects.toThrow(BackupError);
	});

	test("scripts/backup.ts prints the snapshot path; --keep prunes", async () => {
		const out = join(dir, "cli");
		const env = { DATABASE_URL: server.config.databaseUrl, BETTER_AUTH_SECRET: TEST_SECRET };
		const first = await script("backup", [out, "--keep", "1"], env);
		expect(first.code).toBe(0);
		const path = first.stdout.trim().split("\n").at(-1) ?? "";
		expect(existsSync(path)).toBe(true);
		expect(first.stderr).toContain("Snapshot OK");
		await Bun.sleep(1100); // a new second, a new name
		const second = await script("backup", [out, "--keep", "1"], env);
		expect(second.code).toBe(0);
		expect(readdirSync(out)).toHaveLength(1);
	});
});

describe("restore check repairs", () => {
	test("cursors behind, usage drift and photo rows without objects", async () => {
		const server = await createTestServer();
		const owner = await signUp(server.app, "Repair");
		await pushOk(server.app, owner.token, [task("a", Date.now()), task("b", Date.now())]);
		const keep = jpeg("kept");
		const lost = jpeg("lost");
		for (const bytes of [keep, lost]) {
			const put = await server.app.request(`${BASE_URL}/blobs/${sha256(bytes)}`, {
				method: "PUT",
				headers: bearer(owner.token),
				body: bytes,
			});
			expect(put.status).toBe(201);
		}
		const storage = server.server.services.storage;
		expect(storage).not.toBeNull();
		// A database restored over older state: the cursor and total lag, one object is gone.
		await server.db.$client.execute("UPDATE sync_cursor SET seq = 0, bytes = 7");
		await storage?.delete(owner.user.id, sha256(lost));

		const before = await restoreCheck(server.db, { storage, fix: false, local: true });
		expect(before).toMatchObject({
			cursorsBehind: 1,
			bytesDrift: 1,
			blobRows: 2,
			missingObjects: 1,
		});
		expect(before.problems).toHaveLength(3);
		const text = JSON.stringify(before);
		for (const secret of [owner.user.id, owner.email, sha256(lost)]) {
			expect(text).not.toContain(secret);
		}

		const fixed = await restoreCheck(server.db, { storage, fix: true, local: true });
		expect(fixed.fixed).toEqual({
			cursors: 1,
			bytes: 1,
			blobRows: 1,
			erasedAccounts: 0,
			epochs: 1,
		});
		expect(fixed.problems).toEqual([]);
		expect((await restoreCheck(server.db, { storage, fix: false, local: true })).problems).toEqual(
			[],
		);

		// The cursor moved past the stored records to a new sync epoch.
		const seq = Number(
			(await server.db.$client.execute("SELECT seq FROM sync_cursor")).rows[0]?.seq ?? 0,
		);
		expect(seq).toBeGreaterThan(2);
		expect(seq % SYNC_EPOCH_SIZE).toBe(0);
		// The next push gets a fresh sequence number (no collision with stored ones).
		const pushed = await pushOk(server.app, owner.token, [task("c", Date.now())]);
		expect(pushed.accepted).toBe(1);
		expect(pushed.cursor).toBe(seq + 1);
		// Devices now learn the lost photo is missing and upload it again.
		const missing = await trpcData<{ missing: string[] }>(
			await postJson(
				server.app,
				"/trpc/blobs.missing",
				{ hashes: [sha256(keep), sha256(lost)] },
				bearer(owner.token),
			),
		);
		expect(missing.missing).toEqual([sha256(lost)]);
	});

	test("scripts/restore-check.ts: exit 1 with problems, 0 after --fix", async () => {
		const dir = scratchDir();
		const env = testEnv(dir);
		const config = loadConfig(env);
		const server = await createTestServer({ env: { DATABASE_URL: env.DATABASE_URL } });
		const owner = await signUp(server.app, "Cli");
		await pushOk(server.app, owner.token, [task("a", Date.now())]);
		await server.db.$client.execute("UPDATE sync_cursor SET bytes = 1");
		const scriptEnv = {
			DATABASE_URL: config.databaseUrl,
			BETTER_AUTH_SECRET: TEST_SECRET,
			BLOB_DIR: join(dir, "blobs"),
		};
		const check = await script("restore-check", [], scriptEnv);
		expect(check.code).toBe(1);
		expect(check.stdout).toContain("usage drift:      1");
		const fix = await script("restore-check", ["--fix", "--json"], scriptEnv);
		expect(fix.code).toBe(0);
		expect(JSON.parse(fix.stdout)).toMatchObject({ problems: [], fixed: { bytes: 1 } });
	});

	test("an account deleted after the backup comes back with it; --fix deletes it again (LGPD)", async () => {
		const server = await createTestServer();
		const gone = await signUp(server.app, "Gone");
		const stays = await signUp(server.app, "Stays");
		for (const who of [gone, stays]) {
			await pushOk(server.app, who.token, [task(`t-${who.user.id}`, Date.now())]);
		}
		const photo = jpeg("gone photo");
		const put = await server.app.request(`${BASE_URL}/blobs/${sha256(photo)}`, {
			method: "PUT",
			headers: bearer(gone.token),
			body: photo,
		});
		expect(put.status).toBe(201);
		const backups = scratchDir();
		const snapshot = await snapshotDatabase(
			server.db,
			server.config.databaseUrl,
			backups,
			Date.now(),
		);
		// The photos are backed up too (BLOB_STORAGE=disk): a copy of BLOB_DIR.
		const blobDir = (server.config.blobs as { dir: string }).dir;
		const blobBackup = join(scratchDir(), "blobs");
		await Bun.$`cp -r ${blobDir} ${blobBackup}`.quiet();

		// The account is deleted after the backup: the log records its hashed id only.
		const deleted = await postJson(
			server.app,
			"/api/auth/delete-user",
			{ password: gone.password },
			bearer(gone.token),
		);
		expect(deleted.status).toBe(200);
		const log = erasureLogPath(server.config.databaseUrl) ?? "";
		expect(await readErasures(log)).toEqual(new Set([erasureHash(gone.user.id)]));
		const logText = await Bun.file(log).text();
		for (const secret of [gone.user.id, gone.email]) expect(logText).not.toContain(secret);

		// Restore: the snapshot and the photo folder from their backups. The log is
		// not part of either: it stays where it was, beside the live database.
		const restoredDir = scratchDir();
		const restoredFile = join(restoredDir, "atomic.db");
		await Bun.write(restoredFile, Bun.file(snapshot.path));
		const db = createDb({ databaseUrl: `file:${restoredFile}`, databaseAuthToken: null });
		const storage = createBlobStorage({ storage: "disk", dir: blobBackup });
		expect(await storage?.exists(gone.user.id, sha256(photo))).toBe(true);

		const before = await restoreCheck(db, { storage, fix: false, local: true, erasureLog: log });
		expect(before).toMatchObject({ users: 2, erasedAccounts: 1 });
		expect(before.problems).toEqual(["1 deleted accounts are back from the backup (--fix)"]);
		expect(JSON.stringify(before)).not.toContain(gone.user.id);

		const fixed = await restoreCheck(db, { storage, fix: true, local: true, erasureLog: log });
		expect(fixed).toMatchObject({ users: 1, erasedAccounts: 0, problems: [] });
		expect(fixed.fixed.erasedAccounts).toBe(1);
		expect(await storage?.exists(gone.user.id, sha256(photo))).toBe(false);
		// Nothing left anywhere that names the account; the other one is untouched.
		const tables = (
			await db.$client.execute(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
			)
		).rows.map((row) => String(row.name));
		for (const table of tables) {
			const dump = JSON.stringify((await db.$client.execute(`SELECT * FROM "${table}"`)).rows);
			expect(dump).not.toContain(gone.user.id);
			expect(dump).not.toContain(gone.email);
		}
		expect(
			Number((await db.$client.execute("SELECT count(*) AS n FROM sync_record")).rows[0]?.n),
		).toBe(1);
		db.$client.close();
	});

	test("a pre-v2 database is reported as needing the server's migrations", async () => {
		const dir = scratchDir();
		const db = createDb({ databaseUrl: `file:${join(dir, "empty.db")}`, databaseAuthToken: null });
		const report = await restoreCheck(db, {
			storage: createBlobStorage({ storage: "disk", dir: join(dir, "blobs") }),
			fix: false,
			local: true,
		});
		expect(report.migrations).toEqual({ applied: 0, shipped: 2 });
		expect(report.problems).toEqual([]);
		db.$client.close();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("AI evaluation (scripts/ai-eval.ts)", () => {
	let fake: FakeAi;

	beforeAll(() => {
		fake = startFakeAi();
	});

	afterAll(() => fake.stop());

	test("cases fit the request schemas: 30 per kind and language, translations both ways", () => {
		for (const kind of AI_SUGGEST_KINDS) {
			for (const locale of ["en", "pt-BR"] as const) {
				const cases = suggestCases(kind, locale);
				expect(cases).toHaveLength(30);
				for (const request of cases) {
					expect(aiSuggestRequestSchema.safeParse(request).success).toBe(true);
				}
			}
		}
		for (const target of ["en", "pt-BR"] as const) {
			for (const request of translateCases(target)) {
				expect(aiTranslateRequestSchema.safeParse(request).success).toBe(true);
			}
		}
	});

	test("language guesses", () => {
		expect(guessLanguage("Put on your running shoes after breakfast")).toBe("en");
		expect(guessLanguage("Calçar o tênis de corrida depois do café")).toBe("pt-BR");
		expect(guessLanguage("Meditar")).toBe("unknown");
		expect(guessLanguage("Yoga")).toBe("unknown");
	});

	test("reports JSON validity, usable answers, language and latency per group", async () => {
		const provider = createOpenAICompatibleProvider({
			baseUrl: fake.baseUrl,
			apiKey: "sk-test-ai",
			model: "qwen2.5-1.5b-test",
			jsonMode: "json_schema",
			fetch,
		});
		fake.replies.push(
			{ content: { items: ["Put on your shoes after breakfast"] } },
			{ content: "not json" },
			{ content: { items: ["Calçar o tênis depois do café"] } },
			{ content: { wrong: true } },
		);
		const results = await runAiEval({
			provider,
			jsonMode: "json_schema",
			count: 2,
			kinds: ["habit.twoMinute"],
		});
		const summary = summarize(results);
		expect(summary.map((g) => g.group)).toEqual(["habit.twoMinute en", "habit.twoMinute pt-BR"]);
		expect(summary[0]).toMatchObject({ cases: 2, json: 1, usable: 1, languageMatch: 1 });
		expect(summary[1]).toMatchObject({ cases: 2, json: 2, usable: 1, languageMatch: 1 });
		expect(summary[1]?.errors).toEqual({ output_invalid: 1 });
		expect(summary[0]?.p95Ms).toBeGreaterThanOrEqual(0);
		expect(fake.requests.at(-1)?.body.max_tokens).toBeGreaterThan(0);
	});
});
