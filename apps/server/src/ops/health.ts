import type { Config } from "../config";
import type { Database } from "../db";
import { type Logger, safeTag } from "../lib/log";
import { SERVER_VERSION } from "../version";

/**
 * `GET /healthz` (Annex C §1.10): `{ok, db, ai, version}`, content-free.
 *
 * - `db`: a `SELECT 1` within `HEALTH_DB_TIMEOUT_MS`.
 * - `ai`: `off` when AI isn't configured or `AI_FEATURES=` switched it off;
 *   otherwise `GET {AI_BASE_URL}/models` (OpenAI-compatible: llama.cpp,
 *   Ollama and hosted providers all answer it) within
 *   `HEALTH_AI_TIMEOUT_MS`, cached for `HEALTH_AI_TTL_MS` so uptime checks
 *   never load the model server.
 *   It is also `down` while the model server's latest answer to a real call
 *   refused the credentials (401/403): llama.cpp answers `/models` without
 *   the key, so the ping alone would miss an `AI_API_KEY` mismatch.
 * - `ok` is the database alone: the server still syncs while the model is
 *   down (AI calls then fail and are refunded), so a down model must not
 *   make Docker or an uptime monitor restart the server. Watch `ai` for
 *   that (a keyword monitor on `"ai":"down"`).
 *
 * State changes are logged once (`health` lines), never each check.
 */

export const HEALTH_AI_TTL_MS = 30_000;
export const HEALTH_AI_TIMEOUT_MS = 3_000;
export const HEALTH_DB_TIMEOUT_MS = 3_000;

export type HealthState = "ok" | "down";

export interface HealthReport {
	ok: boolean;
	db: HealthState;
	ai: HealthState | "off";
	version: string;
}

export interface Health {
	check(): Promise<HealthReport>;
}

/** Resolves to `fallback` when `task` takes longer than `ms` (or fails). */
async function within<T>(task: Promise<T>, ms: number, fallback: T): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(fallback), ms);
	});
	try {
		return await Promise.race([task.catch(() => fallback), timeout]);
	} finally {
		clearTimeout(timer);
	}
}

export function createHealth(deps: {
	config: Pick<Config, "ai">;
	db: Database;
	/** The AI pipeline, for credential refusals seen on real calls. */
	ai?: { upstreamRejected(): boolean } | null;
	fetch: typeof fetch;
	now: () => number;
	log: Logger;
}): Health {
	const { config, db, log, now } = deps;
	let aiCache: { at: number; state: HealthState } | null = null;
	let aiPing: Promise<HealthState> | null = null;
	const last: Partial<Record<"db" | "ai", HealthState | "off">> = {};

	const pingAi = async (): Promise<HealthState> => {
		const ai = config.ai;
		if (!ai) return "down";
		const headers: Record<string, string> = { Accept: "application/json" };
		if (ai.apiKey) headers.Authorization = `Bearer ${ai.apiKey}`;
		try {
			const response = await deps.fetch(`${ai.baseUrl}/models`, {
				headers,
				signal: AbortSignal.timeout(HEALTH_AI_TIMEOUT_MS),
			});
			await response.body?.cancel().catch(() => {});
			return response.ok ? "ok" : "down";
		} catch {
			return "down";
		}
	};

	const aiState = async (): Promise<HealthState | "off"> => {
		const ai = config.ai;
		if (!ai || !(ai.features.suggest || ai.features.translate)) return "off";
		if (deps.ai?.upstreamRejected()) return "down";
		if (aiCache && now() - aiCache.at < HEALTH_AI_TTL_MS) return aiCache.state;
		aiPing ??= within(pingAi(), HEALTH_AI_TIMEOUT_MS + 500, "down" as HealthState).then((state) => {
			aiCache = { at: now(), state };
			aiPing = null;
			return state;
		});
		return aiPing;
	};

	const dbState = (): Promise<HealthState> =>
		within(
			db.$client.execute("SELECT 1").then(() => "ok" as const),
			HEALTH_DB_TIMEOUT_MS,
			"down",
		);

	const note = (part: "db" | "ai", state: HealthState | "off") => {
		if (last[part] === state) return;
		const first = last[part] === undefined;
		last[part] = state;
		if (first && state !== "down") return;
		const fields = { msg: "health", part, state: safeTag(state) };
		if (state === "down") log.warn(fields);
		else log.info(fields);
	};

	return {
		async check() {
			const [dbResult, aiResult] = await Promise.all([dbState(), aiState()]);
			note("db", dbResult);
			note("ai", aiResult);
			return { ok: dbResult === "ok", db: dbResult, ai: aiResult, version: SERVER_VERSION };
		},
	};
}
