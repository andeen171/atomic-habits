import { describe, expect, test } from "bun:test";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchDir } from "./helpers";

/**
 * The production package in deploy/ (spec §4.7), checked without Docker: the
 * compose file parses and has the shape Compose validates, `docker compose
 * config` accepts it when the CLI is installed (no daemon needed), and the
 * shell scripts parse.
 */

const DEPLOY = join(import.meta.dir, "..", "..", "..", "deploy");

type Service = {
	command?: unknown;
	entrypoint?: unknown;
	env_file?: unknown;
	environment?: Record<string, unknown>;
	healthcheck?: { test?: unknown };
	profiles?: unknown;
};

/**
 * Every environment variable the server reads: the names `src/config.ts`
 * passes to its reader, plus the per-plan limits it builds (`LIMIT_${P}_…`).
 */
async function serverVariables(): Promise<string[]> {
	const source = await Bun.file(join(import.meta.dir, "..", "src", "config.ts")).text();
	const names = new Set([...source.matchAll(/"([A-Z][A-Z0-9_]{2,})"/g)].map((m) => m[1] as string));
	for (const plan of ["FREE", "PRO"]) {
		for (const limit of [...source.matchAll(/`LIMIT_\$\{P\}_([A-Z_]+)`/g)]) {
			names.add(`LIMIT_${plan}_${limit[1]}`);
		}
	}
	return [...names].sort();
}

async function composeFile(): Promise<{ services: Record<string, Service> }> {
	return Bun.YAML.parse(await Bun.file(join(DEPLOY, "docker-compose.yml")).text()) as {
		services: Record<string, Service>;
	};
}

function hasDockerCompose(): boolean {
	try {
		return Bun.spawnSync(["docker", "compose", "version"]).exitCode === 0;
	} catch {
		return false;
	}
}

describe("deploy/docker-compose.yml", () => {
	test("command, entrypoint and healthcheck entries are all strings", async () => {
		// Regression: an unquoted `r.ok ? 0 : 1` parsed as a YAML mapping, and
		// Compose refused the whole file ("healthcheck.test.3 must be a string").
		const { services } = await composeFile();
		expect(Object.keys(services).sort()).toEqual(["caddy", "litestream", "llm", "server"]);
		for (const [name, service] of Object.entries(services)) {
			for (const field of ["command", "entrypoint"] as const) {
				const value = service[field];
				if (value === undefined) continue;
				const list = Array.isArray(value) ? value : [value];
				for (const entry of list)
					expect([name, field, typeof entry]).toEqual([name, field, "string"]);
			}
			const check = service.healthcheck?.test;
			if (check !== undefined) {
				expect(Array.isArray(check)).toBe(true);
				for (const entry of check as unknown[]) {
					expect([name, "healthcheck", typeof entry]).toEqual([name, "healthcheck", "string"]);
				}
			}
		}
		expect(services.server?.healthcheck?.test).toEqual([
			"CMD",
			"bun",
			"-e",
			"fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))",
		]);
		expect(services.llm?.profiles).toEqual(["ai"]);
		expect(services.caddy?.profiles).toEqual(["tls"]);
		expect(services.litestream?.profiles).toEqual(["backup"]);
	});

	test("the server gets an allow-list of its own variables, never the Litestream keys", async () => {
		// Regression: `env_file: .env` handed the API every secret in .env,
		// including the Litestream keys that can overwrite or delete the backups.
		const { services } = await composeFile();
		const server = services.server;
		expect(server?.env_file).toBeUndefined();
		const listed = Object.keys(server?.environment ?? {});
		const read = await serverVariables();
		expect(read).toContain("LIMIT_PRO_SYNC_MB");
		expect(read).toContain("BETTER_AUTH_SECRET");
		// Every variable the server reads reaches it (or a new one would be silently dropped)…
		expect(read.filter((name) => !listed.includes(name))).toEqual([]);
		// …and nothing meant for compose or the other services does.
		expect(
			listed.filter((name) => /^(LITESTREAM_|LLAMA_|BACKUP_|COMPOSE_)|^DOMAIN$/.test(name)),
		).toEqual([]);
		expect(listed.filter((name) => name !== "NODE_ENV" && !read.includes(name))).toEqual([]);
	});

	test.skipIf(!hasDockerCompose())(
		"rendered by `docker compose config`, the server's environment holds no Litestream secret",
		() => {
			const dir = join(scratchDir(), "deploy");
			cpSync(DEPLOY, dir, { recursive: true });
			writeFileSync(
				join(dir, ".env"),
				[
					"COMPOSE_PROFILES=tls,ai,backup",
					"DOMAIN=localhost",
					"BETTER_AUTH_SECRET=auth-secret-x",
					"AI_BASE_URL=http://llm:8080/v1",
					"AI_MODEL=qwen2.5-1.5b-instruct",
					"AI_API_KEY=ai-key-x",
					"EMAIL_DAILY_CAP=",
					"LITESTREAM_ACCESS_KEY_ID=LITESTREAM-KEY-ID-XYZ",
					"LITESTREAM_SECRET_ACCESS_KEY=LITESTREAM-SECRET-XYZ",
				].join("\n"),
			);
			const result = Bun.spawnSync(["docker", "compose", "config", "--format", "json"], {
				cwd: dir,
				stderr: "pipe",
			});
			expect([result.exitCode, result.stderr.toString()]).toEqual([0, ""]);
			const rendered = JSON.parse(result.stdout.toString()) as {
				services: Record<string, { environment?: Record<string, string | null> }>;
			};
			const server = rendered.services.server?.environment ?? {};
			expect(Object.keys(server).filter((name) => name.startsWith("LITESTREAM_"))).toEqual([]);
			expect(JSON.stringify(rendered.services.server)).not.toContain("LITESTREAM-");
			expect(server.BETTER_AUTH_SECRET).toBe("auth-secret-x");
			expect(server.AI_API_KEY).toBe("ai-key-x");
			// Present but empty stays empty (the server's own default applies); absent stays unset.
			expect(server.EMAIL_DAILY_CAP).toBe("");
			expect(server.AI_FEATURES ?? null).toBeNull();
			const litestream = rendered.services.litestream?.environment ?? {};
			expect(litestream.LITESTREAM_SECRET_ACCESS_KEY).toBe("LITESTREAM-SECRET-XYZ");
		},
	);

	test.skipIf(!hasDockerCompose())(
		"`docker compose config` accepts it with every profile (no daemon needed)",
		() => {
			const dir = join(scratchDir(), "deploy");
			cpSync(DEPLOY, dir, { recursive: true });
			writeFileSync(
				join(dir, ".env"),
				[
					"COMPOSE_PROFILES=tls,ai,backup",
					"DOMAIN=localhost",
					"BETTER_AUTH_SECRET=x",
					"AI_BASE_URL=http://llm:8080/v1",
					"AI_MODEL=qwen2.5-1.5b-instruct",
					"AI_API_KEY=k",
				].join("\n"),
			);
			for (const profiles of [[], ["ai", "tls"], ["ai", "tls", "backup"]]) {
				const result = Bun.spawnSync(
					[
						"docker",
						"compose",
						"-f",
						"docker-compose.yml",
						...profiles.flatMap((p) => ["--profile", p]),
						"config",
						"--quiet",
					],
					{ cwd: dir, stderr: "pipe" },
				);
				expect([profiles.join(","), result.exitCode, result.stderr.toString()]).toEqual([
					profiles.join(","),
					0,
					"",
				]);
			}
		},
	);
});

describe("deploy scripts", () => {
	test("backup.sh and restore.sh parse", () => {
		for (const name of ["backup.sh", "restore.sh"]) {
			const result = Bun.spawnSync(["bash", "-n", join(DEPLOY, name)], { stderr: "pipe" });
			expect([name, result.exitCode, result.stderr.toString()]).toEqual([name, 0, ""]);
		}
	});

	test("backup.sh mirrors off-site with `rclone sync` (pruned snapshots leave there too)", async () => {
		// Regression: `rclone copy` never deleted at the destination, so every
		// snapshot (and every deleted account in it) stayed off-site forever.
		const script = await Bun.file(join(DEPLOY, "backup.sh")).text();
		const commands = script
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.startsWith("rclone "));
		expect(commands).toEqual(['rclone sync backups "$copy_to"']);
		// …and never mirrors an empty folder.
		expect(script).toContain("compgen -G 'backups/atomic-*.db'");
	});
});

describe("deploy/Caddyfile access logs (D55)", () => {
	/** The `request>uri regexp` filters, as Caddy's `regexp` field filter applies them. */
	async function uriFilters(): Promise<{ pattern: string; replacement: string }[]> {
		const caddyfile = await Bun.file(join(DEPLOY, "Caddyfile")).text();
		return [
			...caddyfile.matchAll(/^\s*request>uri regexp "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"\s*$/gm),
		].map((m) => ({ pattern: m[1] as string, replacement: m[2] as string }));
	}

	/** Go's `Regexp.ReplaceAllString` (global; `${1}` is group 1, empty when it didn't take part). */
	function apply(filter: { pattern: string; replacement: string }, uri: string): string {
		return uri.replace(
			new RegExp(filter.pattern, "g"),
			filter.replacement.replace(/\$\{(\d+)\}/g, "$$$1"),
		);
	}

	test("both log blocks carry the same filter, and it keeps tokens and photo hashes out", async () => {
		const filters = await uriFilters();
		// The global log (Caddy's own errors) and the site's access log.
		expect(filters).toHaveLength(2);
		expect(filters[1]).toEqual(filters[0] as { pattern: string; replacement: string });
		const filter = filters[0] as { pattern: string; replacement: string };
		const cases: [string, string][] = [
			["/account/export?t=abc", "/account/export"],
			["/account/reset-password?token=x&lang=en", "/account/reset-password"],
			[
				"/api/auth/reset-password/TOK123?callbackURL=https%3A%2F%2Fapp.example.com",
				"/api/auth/reset-password/",
			],
			[`/blobs/${"a".repeat(64)}`, "/blobs/"],
			["/api/auth/verify-email?token=eyJhbGciOi&callbackURL=x", "/api/auth/verify-email"],
			["/trpc/sync.pull?input=%7B%22cursor%22%3A0%7D", "/trpc/sync.pull"],
			["/trpc/account.get", "/trpc/account.get"],
			["/healthz", "/healthz"],
		];
		for (const [uri, logged] of cases) expect([uri, apply(filter, uri)]).toEqual([uri, logged]);
	});

	test("request headers are dropped in both blocks, response headers in the site's", async () => {
		const caddyfile = await Bun.file(join(DEPLOY, "Caddyfile")).text();
		expect(caddyfile.match(/^\s*request>headers delete\s*$/gm)).toHaveLength(2);
		expect(caddyfile.match(/^\s*resp_headers delete\s*$/gm)).toHaveLength(1);
	});
});
