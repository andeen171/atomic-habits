import { describe, expect, test } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb } from "../src/db";
import { migrationsFolder, runMigrations } from "../src/db/migrate";
import { scratchDir } from "./helpers";

const utf8 = (text: string) => Buffer.byteLength(text, "utf8");

/** A database at v1 (only `0000_init`), as a deployed v1 server left it. */
async function v1Database() {
	const dir = scratchDir();
	const v1Folder = join(dir, "migrations-v1");
	cpSync(migrationsFolder, v1Folder, { recursive: true });
	const journalPath = join(v1Folder, "meta", "_journal.json");
	const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
	journal.entries = journal.entries.filter((entry) => entry.tag === "0000_init");
	writeFileSync(journalPath, JSON.stringify(journal));
	const databaseUrl = `file:${join(dir, "v1.db")}`;
	const db = createDb({ databaseUrl, databaseAuthToken: null });
	await migrate(db, { migrationsFolder: v1Folder });
	return { db, databaseUrl };
}

describe("migration 0001_v2", () => {
	test("upgrades a v1 database: new columns and tables, sync bytes backfilled", async () => {
		const { db, databaseUrl } = await v1Database();
		const c = db.$client;
		await c.execute(
			"INSERT INTO user (id, name, email, email_verified) VALUES ('u1', 'Ana', 'ana@example.com', 0), ('u2', 'Ben', 'ben@example.com', 0)",
		);
		// v1 stored documents as pushed (not canonical JSON).
		const docs = [
			'{"id":"t1","title":"Ler à noite 📚","updatedAt":1,"deletedAt":null}',
			'{"title":"Plan","id":"t2","updatedAt":2,"deletedAt":null}',
		];
		await c.execute("INSERT INTO sync_cursor (user_id, seq) VALUES ('u1', 2), ('u2', 0)");
		for (const [i, data] of docs.entries()) {
			await c.execute({
				sql: "INSERT INTO sync_record (user_id, collection, id, data, updated_at, deleted_at, seq) VALUES ('u1', 'tasks', ?, ?, ?, NULL, ?)",
				args: [`t${i + 1}`, data, i + 1, i + 1],
			});
		}

		await runMigrations(db, databaseUrl);

		const cursors = await c.execute("SELECT user_id, seq, bytes FROM sync_cursor ORDER BY user_id");
		expect(cursors.rows.map((r) => [r.user_id, Number(r.seq), Number(r.bytes)])).toEqual([
			["u1", 2, utf8(docs[0] ?? "") + utf8(docs[1] ?? "")],
			["u2", 0, 0],
		]);
		const user = await c.execute(
			"SELECT stripe_customer_id, ai_consent_at, ai_translate FROM user WHERE id = 'u1'",
		);
		expect(user.rows[0]).toMatchObject({
			stripe_customer_id: null,
			ai_consent_at: null,
			ai_translate: 0,
		});
		const tables = await c.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
		);
		const names = tables.rows.map((r) => String(r.name));
		for (const table of ["subscription", "plan_grant", "ai_usage", "blob", "export_token"]) {
			expect(names).toContain(table);
		}

		// From now on the triggers keep `bytes` exact.
		const bytes = async () =>
			Number(
				(await c.execute("SELECT bytes FROM sync_cursor WHERE user_id = 'u1'")).rows[0]?.bytes,
			);
		const before = await bytes();
		await c.execute(
			"INSERT INTO sync_record (user_id, collection, id, data, updated_at, deleted_at, seq) VALUES ('u1', 'tasks', 't3', '{\"é\":1}', 3, NULL, 3)",
		);
		expect(await bytes()).toBe(before + utf8('{"é":1}'));
		await c.execute("UPDATE sync_record SET data = '{}' WHERE user_id = 'u1' AND id = 't1'");
		expect(await bytes()).toBe(before + utf8('{"é":1}') - utf8(docs[0] ?? "") + 2);
		await c.execute("DELETE FROM sync_record WHERE user_id = 'u1'");
		expect(await bytes()).toBe(0);

		// Deleting a user cascades to the new tables too.
		await c.execute(
			"INSERT INTO plan_grant (id, user_id, plan, reason) VALUES ('g1', 'u2', 'pro', 'beta')",
		);
		await c.execute("INSERT INTO ai_usage (user_id, day) VALUES ('u2', '2026-10-20')");
		await c.execute("DELETE FROM user WHERE id = 'u2'");
		const left = await c.execute(
			"SELECT (SELECT count(*) FROM plan_grant) AS grants, (SELECT count(*) FROM ai_usage) AS usage, (SELECT count(*) FROM sync_cursor WHERE user_id = 'u2') AS cursors",
		);
		expect(left.rows[0]).toMatchObject({ grants: 0, usage: 0, cursors: 0 });
		db.$client.close();
	});

	test("is idempotent", async () => {
		const { db, databaseUrl } = await v1Database();
		await runMigrations(db, databaseUrl);
		await runMigrations(db, databaseUrl);
		const applied = await db.$client.execute("SELECT count(*) AS n FROM __drizzle_migrations");
		expect(Number(applied.rows[0]?.n)).toBe(2);
		db.$client.close();
	});
});
