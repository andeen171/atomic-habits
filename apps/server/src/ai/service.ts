import {
	type AiQuota,
	type AiSuggestKind,
	type AiSuggestOutput,
	type AiSuggestRequest,
	type AiTranslateRequest,
	type AiTranslateResponse,
	type PlanLimits,
	nextUtcMidnight,
} from "@atomic/core";
import { utcDay } from "../account/usage";
import type { AiConfig } from "../config";
import type { Database } from "../db";
import type { Logger } from "../lib/log";
import { processSuggestion, processTranslation } from "./output";
import { type Prompt, RETRY_TEMPERATURE, suggestPrompt, translatePrompt } from "./prompts";
import { AiError, type AiProvider, createOpenAICompatibleProvider } from "./provider";
import {
	type QuotaField,
	type Reservation,
	consumeQuota,
	recordTokensOut,
	refundQuota,
} from "./quota";
import { Semaphore, SemaphoreError } from "./semaphore";

/**
 * The AI pipeline after the router's checks (feature, consent, verified
 * email, burst limit; spec §4.5): atomic quota, global daily cap,
 * semaphore, the model call with one retry, validation and cleaning.
 *
 * - **One end-to-end deadline** (`AI_TIMEOUT_MS`, translate
 *   `AI_TRANSLATE_TIMEOUT_MS`) covers the queue wait and every attempt; the
 *   upstream call is aborted with `AbortSignal.any([deadline, client])`, so
 *   it also stops when the client goes away.
 * - **Refunds:** quota taken for a call that then fails (busy, timeout,
 *   upstream error, unusable answer, client gone) is given back.
 * - **Privacy:** prompts and answers are never logged, cached or stored;
 *   the `ai` log line carries the operation, the kind, the outcome, the
 *   attempt count, timings and the upstream status only.
 */

/** A retry after an unusable answer needs at least this much time left (spec §4.5). */
export const RETRY_MIN_REMAINING_MS = 8_000;
/** Longest wait for a free model slot (Annex C §6.6), within the deadline. */
export const QUEUE_WAIT_MS = 10_000;

export interface SuggestResult {
	/** Parse with `aiSuggestOutputSchemas[kind]` on the client. */
	output: AiSuggestOutput<AiSuggestKind>;
	quota: AiQuota;
}

export interface CallContext {
	userId: string;
	limits: PlanLimits;
	/** The client's request signal (aborts when it disconnects). */
	signal: AbortSignal;
}

export interface AiService {
	readonly config: AiConfig;
	suggest(request: AiSuggestRequest, call: CallContext): Promise<SuggestResult>;
	translate(request: AiTranslateRequest, call: CallContext): Promise<AiTranslateResponse>;
}

export interface AiServiceDeps {
	config: AiConfig;
	db: Database;
	log: Logger;
	/** The server clock (quota days). Deadlines use real timers. */
	now: () => number;
	fetch: typeof fetch;
	/** Replaces the OpenAI-compatible adapter (tests). */
	provider?: AiProvider;
}

interface Job<T> {
	op: "suggest" | "translate";
	kind: string;
	call: CallContext;
	field: QuotaField;
	amount: number;
	limit: number;
	timeoutMs: number;
	prompt: Prompt;
	process: (value: unknown) => T;
}

export function createAiService(deps: AiServiceDeps): AiService {
	const { config, db, log, now } = deps;
	const provider =
		deps.provider ??
		createOpenAICompatibleProvider({
			baseUrl: config.baseUrl,
			apiKey: config.apiKey,
			model: config.model,
			jsonMode: config.jsonMode,
			fetch: deps.fetch,
		});
	const semaphore = new Semaphore(config.maxConcurrency, config.queueMax);
	/** Model calls admitted today across all users (`AI_GLOBAL_DAILY_REQUESTS`; 0 = no cap). */
	let global = { day: "", count: 0 };

	const takeGlobal = (day: string): boolean => {
		if (global.day !== day) global = { day, count: 0 };
		if (config.globalDailyRequests > 0 && global.count >= config.globalDailyRequests) return false;
		global.count++;
		return true;
	};
	const giveGlobal = (day: string) => {
		if (global.day === day && global.count > 0) global.count--;
	};

	async function run<T>(job: Job<T>): Promise<{ value: T; quota: AiQuota }> {
		const started = performance.now();
		const at = now();
		const day = utcDay(at);
		const resetsAt = nextUtcMidnight(at);
		const client = job.call.signal;
		const deadline = new AbortController();
		const timer = setTimeout(() => deadline.abort(), job.timeoutMs);
		const signal = AbortSignal.any([deadline.signal, client]);
		const remaining = () => job.timeoutMs - (performance.now() - started);

		let attempts = 0;
		let tokensOut = 0;
		let upstreamStatus: number | undefined;
		let reservation: Reservation | null = null;
		let globalTaken = false;
		let release: (() => void) | null = null;
		const finish = (outcome: string) => {
			const fields = {
				msg: "ai",
				op: job.op,
				kind: job.kind,
				outcome,
				attempts,
				ms: Math.round(performance.now() - started),
				upstream: upstreamStatus,
			};
			if (outcome === "ok") log.info(fields);
			else log.warn(fields);
		};

		try {
			// 1. The user's quota, atomically.
			const consumed = await consumeQuota(
				db,
				{ userId: job.call.userId, day, field: job.field, amount: job.amount },
				job.limit,
			);
			if (!consumed.ok) throw new AiError("quota", { retryAt: resetsAt });
			reservation = consumed.reservation;
			const quota: AiQuota = {
				limit: job.limit,
				remaining: Math.max(0, job.limit - consumed.used),
				resetsAt,
			};

			// 2. The server's daily cap.
			if (!takeGlobal(day)) throw new AiError("busy");
			globalTaken = true;

			// 3. A model slot, waiting at most QUEUE_WAIT_MS within the deadline.
			try {
				release = await semaphore.acquire(signal, Math.min(QUEUE_WAIT_MS, remaining()));
			} catch (error) {
				if (client.aborted) throw new AiError("aborted");
				if (error instanceof SemaphoreError) throw new AiError("busy");
				throw error;
			}

			// 4. The model, with one retry at a low temperature after an unusable answer.
			let temperature = job.prompt.temperature;
			for (;;) {
				attempts++;
				try {
					const result = await provider.complete({ ...job.prompt, temperature, signal });
					tokensOut += result.tokensOut;
					const value = job.process(result.value);
					finish("ok");
					return { value, quota };
				} catch (error) {
					if (client.aborted) throw new AiError("aborted");
					if (deadline.signal.aborted) throw new AiError("timeout");
					if (!(error instanceof AiError)) throw new AiError("failed");
					upstreamStatus = error.detail.upstreamStatus ?? upstreamStatus;
					if (error.kind !== "invalid") throw error;
					if (attempts >= 2 || remaining() < RETRY_MIN_REMAINING_MS) {
						throw new AiError("failed");
					}
					temperature = RETRY_TEMPERATURE;
				}
			}
		} catch (error) {
			const failure = error instanceof AiError ? error : new AiError("failed");
			finish(failure.kind);
			// Nothing was delivered: give the quota back (and the global slot when
			// the model was never asked).
			if (reservation) await refundQuota(db, reservation).catch(() => {});
			if (globalTaken && attempts === 0) giveGlobal(day);
			throw failure;
		} finally {
			clearTimeout(timer);
			release?.();
			if (tokensOut > 0) {
				await recordTokensOut(db, job.call.userId, day, tokensOut).catch(() => {});
			}
		}
	}

	return {
		config,

		async suggest(request, call) {
			const { value, quota } = await run({
				op: "suggest",
				kind: request.kind,
				call,
				field: "requests",
				amount: 1,
				limit: call.limits.aiRequestsPerDay,
				timeoutMs: config.timeoutMs,
				prompt: suggestPrompt(request, config.jsonMode),
				process: (raw) => processSuggestion(request, raw),
			});
			return { output: value, quota };
		},

		async translate(request, call) {
			const chars = request.items.reduce((sum, item) => sum + item.text.length, 0);
			const { value, quota } = await run({
				op: "translate",
				kind: request.target,
				call,
				field: "translate_chars",
				amount: chars,
				limit: call.limits.aiTranslateCharsPerDay,
				timeoutMs: config.translateTimeoutMs,
				prompt: translatePrompt(request, config.jsonMode),
				process: (raw) => processTranslation(request, raw),
			});
			return { items: value, quota };
		},
	};
}
