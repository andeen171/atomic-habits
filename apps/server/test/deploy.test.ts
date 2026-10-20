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
	healthcheck?: { test?: unknown };
	profiles?: unknown;
};

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
