import type { AccountInfo, ServerInfo } from "./account";
import type { AccountController } from "./account-controller";
import {
	type AiQuota,
	type AiSuggestInput,
	type AiSuggestKind,
	type AiSuggestOutput,
	type AiTranslateRequest,
	aiSuggestOutputSchemas,
	aiSuggestResponseSchema,
	aiTranslateResponseSchema,
} from "./ai";
import { toDayKey } from "./dates";
import { type Locale, type MessageKey, resolveLocale } from "./i18n";
import { RemoteError } from "./remote";
import type { AtomicStore } from "./store";
import type { SyncController, SyncSession } from "./sync-controller";
import { translateBatches } from "./translate";

/**
 * The AI beta client (spec §3.6, D31; Annex C §1.6, §1.8 and §3.5).
 *
 * - **Availability** (the sparkle button follows it): hidden without an
 *   account or when the server has no AI; offline; unverified (email on and
 *   not confirmed, D67); needs consent (server-side, per account); ready.
 *   Every AI surface shows a "Beta" badge while `features.ai.beta` is on.
 * - **Suggestions**: `suggest(kind, input, locale)` posts `ai.suggest`, waits
 *   `features.ai.timeoutMs + 5 s`, parses the output with the shared schema
 *   and caches answers in memory only (an LRU of 50 per account, keyed by
 *   kind, locale and input). Failures are `AiError`s whose `kind` picks the
 *   UI string (`aiErrorKey`).
 * - **Translation runner** (only with the account's translate switch on and
 *   AI ready): after each completed pull, 3 s after a locale change, and
 *   when translation is turned on, it sends up to 3 batches of
 *   `translationQueue` (`translateBatches`) and writes them with
 *   `applyTranslations`. A quota answer stops it until `resetsAt`. It never
 *   runs before the first completed pull of the session (spec §3.6).
 *
 * The journal is never sent (D19): there is no journal kind, and the queue
 * never includes journal or tracker-entry text.
 */

export const AI_ERROR_KINDS = [
	"quota",
	"busy",
	"offline",
	"timeout",
	"consent",
	"unverified",
	"disabled",
	"auth",
	"failed",
	/** The caller canceled (closed the popover): show nothing. */
	"aborted",
] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

export class AiError extends Error {
	constructor(
		readonly kind: AiErrorKind,
		/** quota: when it resets (next 00:00 UTC); busy: when to retry, if the server said. */
		readonly resetsAt?: number,
	) {
		super(`AI ${kind}`);
		this.name = "AiError";
	}
}

/** The popover message for a failed AI call; null when nothing should show (consent opens the dialog). */
export function aiErrorKey(error: unknown): MessageKey | null {
	const kind = error instanceof AiError ? error.kind : "failed";
	switch (kind) {
		case "quota":
			return "ai.error.quota";
		case "busy":
			return "ai.error.busy";
		case "offline":
			return "ai.error.offline";
		case "timeout":
			return "ai.error.timeout";
		case "unverified":
			return "ai.error.unverified";
		case "auth":
			return "account.errors.sessionEnded";
		case "consent":
		case "disabled":
		case "aborted":
			return null;
		default:
			return "ai.error.failed";
	}
}

const isAbort = (error: unknown) => {
	const name = (error as { name?: unknown } | null)?.name;
	return name === "AbortError" || name === "TimeoutError";
};

/**
 * The `AiError` for a failed call (Annex C §1.6 "Errors → UI"). A thrown
 * fetch is `offline`; an abort is `timeout` unless the caller canceled.
 */
export function aiErrorFrom(
	error: unknown,
	ctx: { timedOut?: boolean; canceled?: boolean; now?: number } = {},
): AiError {
	if (error instanceof AiError) return error;
	if (ctx.canceled) return new AiError("aborted");
	if (ctx.timedOut) return new AiError("timeout");
	if (!(error instanceof RemoteError)) return new AiError(isAbort(error) ? "timeout" : "offline");
	const { status, reason, retryAt } = error;
	if (status === 429) {
		if (reason === "quota") return new AiError("quota", retryAt);
		return new AiError("busy", retryAt);
	}
	if (status === 412) return new AiError(reason === "unverified" ? "unverified" : "consent");
	if (status === 401 || status === 403) return new AiError("auth");
	if (status === 501 || status === 404) return new AiError("disabled");
	if (status === 503) return new AiError("busy", retryAt);
	if (status === 504) return new AiError("timeout");
	if (status === 499) return new AiError("aborted");
	return new AiError("failed");
}

export type AiStatus = "hidden" | "offline" | "unverified" | "needs-consent" | "ready";

export interface AiAvailability {
	status: AiStatus;
	/** Show the "Beta" badge on AI surfaces (`features.ai.beta`). */
	beta: boolean;
	/** The server offers suggestions (the sparkle shows when this and `status !== "hidden"`). */
	suggest: boolean;
	/** The server offers translation of the user's content. */
	translateFeature: boolean;
	/** The account's "Translate my content" switch. */
	translateOn: boolean;
	/** The translation runner may run (ready, feature on, switch on). */
	translating: boolean;
	/** The last quota each feature reported (requests / characters). */
	quota: { suggest: AiQuota | null; translate: AiQuota | null };
	/** Quota used up until then (epoch ms), from a refused call. */
	blockedUntil: { suggest: number | null; translate: number | null };
}

/** The Annex C §1.6 availability matrix (pure). */
export function aiStatusOf(input: {
	signedIn: boolean;
	server: ServerInfo | null;
	account: AccountInfo | null;
	online: boolean;
}): AiStatus {
	const ai = input.server?.features.ai;
	if (!input.signedIn || !ai || (!ai.suggest && !ai.translate)) return "hidden";
	// Consent and verification are unknown until the account loads (or its cache).
	if (!input.account) return "hidden";
	if (!input.online) return "offline";
	// D67: the requirement applies only while email is on; Google addresses arrive verified.
	if (ai.requiresVerifiedEmail && input.server?.features.email && !input.account.emailVerified)
		return "unverified";
	if (input.account.ai.consentAt == null) return "needs-consent";
	return "ready";
}

export interface AiSuggestOptions {
	signal?: AbortSignal;
	/** Skip the cache ("Try others"); the answer still replaces the cached one. */
	fresh?: boolean;
}

export interface AiClient {
	availability(): AiAvailability;
	subscribe(listener: () => void): () => void;
	suggest<K extends AiSuggestKind>(
		kind: K,
		input: AiSuggestInput<K>,
		locale: Locale,
		opts?: AiSuggestOptions,
	): Promise<{ output: AiSuggestOutput<K>; quota: AiQuota }>;
	/**
	 * One translation run now: up to 3 batches. Returns the fields written
	 * (0 when translation is off, blocked by quota, or nothing is left).
	 */
	translateOnce(): Promise<number>;
	/** Starts the runner triggers; returns a stop function. */
	startTranslationRunner(): () => void;
	/** Re-reads `isOnline` and the controllers (connectivity changed). */
	refresh(): void;
	dispose(): void;
}

export interface AiTimers {
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	now(): number;
}

export interface AiClientOptions {
	store: AtomicStore;
	sync: SyncController;
	account: AccountController;
	/** Default: `navigator.onLine` where it exists, else true. */
	isOnline?: () => boolean;
	/** The resolved app locale (default: `settings.locale`, then the device languages). */
	locale?: () => Locale;
	timers?: Partial<AiTimers>;
	/** In-memory answers kept (default 50). */
	cacheSize?: number;
	/** Wait after a locale change before translating (default 3 s). */
	translateDelayMs?: number;
}

/** Margin over the server's deadline before the client gives up (spec §3.6). */
export const AI_CLIENT_MARGIN_MS = 5_000;
export const AI_CACHE_SIZE = 50;

const defaultTimers: AiTimers = {
	setTimeout: (callback, ms) => setTimeout(callback, ms),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	now: () => Date.now(),
};

const defaultOnline = () => {
	const online = (globalThis as { navigator?: { onLine?: unknown } }).navigator?.onLine;
	return typeof online === "boolean" ? online : true;
};

const defaultLocale = (store: AtomicStore) => () =>
	resolveLocale(
		store.getState().settings.locale,
		(globalThis as { navigator?: { languages?: readonly string[] } }).navigator?.languages ?? [],
	);

/** JSON with sorted object keys: equal inputs give equal cache keys. */
function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

const ownerOf = (session: SyncSession | null) =>
	session ? `${session.serverUrl}\n${session.user.id}` : null;

export function createAiClient({
	store,
	sync,
	account,
	isOnline = defaultOnline,
	locale = defaultLocale(store),
	timers: timerOverrides,
	cacheSize = AI_CACHE_SIZE,
	translateDelayMs = 3_000,
}: AiClientOptions): AiClient {
	const timers: AiTimers = { ...defaultTimers, ...timerOverrides };
	const listeners = new Set<() => void>();
	const cache = new Map<string, { output: unknown; quota: AiQuota }>();
	let owner = ownerOf(sync.getSession());
	let quota: AiAvailability["quota"] = { suggest: null, translate: null };
	let blockedUntil: AiAvailability["blockedUntil"] = { suggest: null, translate: null };
	let state = compute();
	let translating: Promise<number> | null = null;
	/** The runner's trigger for "translation just turned on" (set while it runs). */
	let onTranslateOn: (() => void) | null = null;

	function compute(): AiAvailability {
		const syncState = sync.getState();
		const server = syncState.server;
		const info = account.getState().account;
		const ai = server?.features.ai ?? null;
		const status = aiStatusOf({
			signedIn: sync.getSession() !== null,
			server,
			account: info,
			online: isOnline(),
		});
		const translateFeature = Boolean(ai?.translate);
		const translateOn = Boolean(info?.ai.translate);
		return {
			status,
			beta: ai ? ai.beta !== false : false,
			suggest: Boolean(ai?.suggest),
			translateFeature,
			translateOn,
			translating: status === "ready" && translateFeature && translateOn,
			quota,
			blockedUntil,
		};
	}

	const same = (a: AiAvailability, b: AiAvailability) =>
		a.status === b.status &&
		a.beta === b.beta &&
		a.suggest === b.suggest &&
		a.translateFeature === b.translateFeature &&
		a.translateOn === b.translateOn &&
		a.translating === b.translating &&
		a.quota === b.quota &&
		a.blockedUntil === b.blockedUntil;

	const update = () => {
		const next = ownerOf(sync.getSession());
		if (next !== owner) {
			// Another account (or none): nothing carries over.
			owner = next;
			cache.clear();
			quota = { suggest: null, translate: null };
			blockedUntil = { suggest: null, translate: null };
		}
		const computed = compute();
		if (same(computed, state)) return;
		const wasTranslating = state.translating;
		state = computed;
		for (const listener of [...listeners]) listener();
		if (!wasTranslating && state.translating) onTranslateOn?.();
	};

	const setQuota = (feature: "suggest" | "translate", value: AiQuota | null) => {
		quota = { ...quota, [feature]: value };
	};
	const block = (feature: "suggest" | "translate", until: number | null) => {
		if (blockedUntil[feature] === until) return;
		blockedUntil = { ...blockedUntil, [feature]: until };
	};

	/** Side effects of a refused call: refresh what it proved stale. */
	const handle = (error: AiError, feature: "suggest" | "translate") => {
		if (error.kind === "quota") {
			const until = error.resetsAt ?? Number.NaN;
			block(feature, Number.isFinite(until) ? until : timers.now() + 60 * 60_000);
		} else if (error.kind === "consent" || error.kind === "unverified") {
			void account.refresh();
		} else if (error.kind === "auth") {
			void sync.syncNow();
		} else if (error.kind === "disabled") {
			void sync.loadServerInfo(undefined, { force: true }).catch(() => undefined);
		}
		update();
	};

	const deadlineOf = (feature: "suggest" | "translate") => {
		const ai = sync.getState().server?.features.ai;
		const serverMs =
			feature === "translate" ? (ai?.translateTimeoutMs ?? ai?.timeoutMs) : ai?.timeoutMs;
		return (typeof serverMs === "number" && serverMs > 0 ? serverMs : 25_000) + AI_CLIENT_MARGIN_MS;
	};

	/** A POST with the client deadline (`timeoutMs + 5 s`) and the caller's signal. */
	const call = async <T>(
		feature: "suggest" | "translate",
		run: (session: SyncSession, signal: AbortSignal | undefined) => Promise<T>,
		signal?: AbortSignal,
	): Promise<T> => {
		const session = sync.getSession();
		if (!session) throw new AiError("auth");
		const Controller = (globalThis as { AbortController?: typeof AbortController }).AbortController;
		const controller = Controller ? new Controller() : null;
		let timedOut = false;
		const abort = () => controller?.abort();
		const timer = timers.setTimeout(() => {
			timedOut = true;
			abort();
		}, deadlineOf(feature));
		if (signal) {
			if (signal.aborted) abort();
			else signal.addEventListener("abort", abort);
		}
		try {
			return await run(session, controller?.signal ?? signal);
		} catch (error) {
			const failure = aiErrorFrom(error, { timedOut, canceled: signal?.aborted === true });
			handle(failure, feature);
			throw failure;
		} finally {
			timers.clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
		}
	};

	const clientFor = (session: SyncSession) =>
		// The deadline is ours (`call`), so the remote client's own timeout is off.
		sync.remoteClient(session.serverUrl, { timeoutMs: 0 });

	const refuseUnlessReady = (feature: "suggest" | "translate") => {
		update();
		const available =
			feature === "suggest" ? state.suggest : state.translateFeature && state.translateOn;
		switch (state.status) {
			case "hidden":
				throw new AiError(sync.getSession() ? "disabled" : "auth");
			case "offline":
				throw new AiError("offline");
			case "unverified":
				throw new AiError("unverified");
			case "needs-consent":
				throw new AiError("consent");
		}
		if (!available) throw new AiError(feature === "suggest" ? "disabled" : "consent");
		const until = blockedUntil[feature];
		if (until !== null) {
			if (timers.now() < until) throw new AiError("quota", until);
			block(feature, null);
		}
	};

	async function suggest<K extends AiSuggestKind>(
		kind: K,
		input: AiSuggestInput<K>,
		targetLocale: Locale,
		opts: AiSuggestOptions = {},
	): Promise<{ output: AiSuggestOutput<K>; quota: AiQuota }> {
		refuseUnlessReady("suggest");
		const key = `${kind}\n${targetLocale}\n${stableJson(input)}`;
		const cached = opts.fresh ? undefined : cache.get(key);
		if (cached) {
			// LRU: most recently used last.
			cache.delete(key);
			cache.set(key, cached);
			return { output: cached.output as AiSuggestOutput<K>, quota: cached.quota };
		}
		const forOwner = owner;
		const answer = await call(
			"suggest",
			(session, signal) =>
				clientFor(session).http.mutation(
					"ai.suggest",
					session.token,
					aiSuggestResponseSchema,
					{ kind, locale: targetLocale, input },
					signal,
				),
			opts.signal,
		);
		const parsed = aiSuggestOutputSchemas[kind].safeParse(answer.output);
		if (!parsed.success) throw new AiError("failed");
		const output = parsed.data as AiSuggestOutput<K>;
		if (owner === forOwner) {
			setQuota("suggest", answer.quota);
			block("suggest", null);
			cache.delete(key);
			cache.set(key, { output, quota: answer.quota });
			while (cache.size > Math.max(0, cacheSize)) {
				const oldest = cache.keys().next().value;
				if (oldest === undefined) break;
				cache.delete(oldest);
			}
			update();
		}
		return { output, quota: answer.quota };
	}

	function translateOnce(): Promise<number> {
		if (translating) return translating;
		update();
		if (!state.translating) return Promise.resolve(0);
		const until = blockedUntil.translate;
		if (until !== null && timers.now() < until) return Promise.resolve(0);
		if (until !== null) block("translate", null);
		const forOwner = owner;
		const run = (async () => {
			try {
				return await translateBatches(
					store,
					(request: AiTranslateRequest) =>
						call("translate", async (session, signal) => {
							const answer = await clientFor(session).http.mutation(
								"ai.translate",
								session.token,
								aiTranslateResponseSchema,
								request,
								signal,
							);
							if (owner === forOwner) {
								setQuota("translate", answer.quota);
								update();
							}
							return answer;
						}),
					{
						locale: locale(),
						today: toDayKey(timers.now()),
						shouldStop: () => owner !== forOwner || !state.translating,
					},
				);
			} catch (error) {
				// Handled in `call` (quota blocks until reset); the next trigger retries.
				if (!(error instanceof AiError)) console.warn("[atomic] Translation failed", error);
				return 0;
			} finally {
				translating = null;
			}
		})();
		translating = run;
		return run;
	}

	const unsubscribers = [sync.subscribe(update), account.subscribe(update)];

	return {
		availability: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		suggest,
		translateOnce,
		startTranslationRunner() {
			let pulled = false;
			let delay: unknown = null;
			let stopped = false;
			const run = () => {
				if (!stopped && pulled) void translateOnce();
			};
			const clearDelay = () => {
				if (delay !== null) timers.clearTimeout(delay);
				delay = null;
			};
			const later = () => {
				clearDelay();
				delay = timers.setTimeout(() => {
					delay = null;
					run();
				}, translateDelayMs);
			};
			const stopRounds = sync.subscribeRounds((result) => {
				if (!result.complete) return;
				pulled = true;
				run();
			});
			let lastLocale = locale();
			const stopStore = store.subscribe((next, prev) => {
				if (
					next.settings.locale === prev.settings.locale &&
					next.settings.contentLanguage === prev.settings.contentLanguage
				)
					return;
				const current = locale();
				const languageBack =
					next.settings.contentLanguage === "follow" && prev.settings.contentLanguage !== "follow";
				if (current !== lastLocale || languageBack) {
					lastLocale = current;
					later();
				}
			});
			onTranslateOn = run;
			return () => {
				stopped = true;
				clearDelay();
				stopRounds();
				stopStore();
				onTranslateOn = null;
			};
		},
		refresh: update,
		dispose() {
			for (const unsubscribe of unsubscribers) unsubscribe();
			listeners.clear();
			cache.clear();
			onTranslateOn = null;
		},
	};
}
