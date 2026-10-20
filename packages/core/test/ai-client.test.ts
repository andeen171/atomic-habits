import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { AccountInfo, ServerInfo } from "../src/account";
import { createAccountController } from "../src/account-controller";
import {
	AiError,
	type AiErrorKind,
	type AiStatus,
	aiErrorFrom,
	aiErrorKey,
	aiStatusOf,
	createAiClient,
} from "../src/ai-client";
import { type Locale, resolveLocale } from "../src/i18n";
import { translationId } from "../src/model";
import { RemoteError } from "../src/remote";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import { createSyncController } from "../src/sync-controller";
import { textHash } from "../src/translate";
import {
	FAKE_AI_RESET,
	FAKE_URL,
	fakeCloud,
	flush,
	manualTimers,
	v2ServerInfo,
} from "./support/fake-cloud";

/**
 * AI client (spec §3.6, D31; Annex C §1.6, §1.8, §8 `ai-client.test.ts`):
 * the availability matrix, error kinds, the client deadline from
 * `features.ai.timeoutMs`, the in-memory LRU, and the translation runner
 * (after a completed pull, never re-translating unchanged text, stopping on
 * quota until `resetsAt`).
 */

const AI = {
	suggest: true,
	translate: true,
	hosting: "self-hosted",
	providerName: null,
	requiresVerifiedEmail: true,
	limits: {},
	beta: true,
	timeoutMs: 20_000,
};

type AiFeature = NonNullable<ServerInfo["features"]["ai"]>;

function meta(ai: Partial<AiFeature> | null = {}, email = false): Partial<ServerInfo> {
	return {
		features: {
			email,
			google: null,
			billing: null,
			ai: ai === null ? null : ({ ...AI, ...ai } as AiFeature),
			blobs: null,
		},
	};
}

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

async function setup(
	opts: { ai?: Partial<AiFeature> | null; email?: boolean; online?: () => boolean } = {},
) {
	const cloud = fakeCloud({ meta: meta(opts.ai, opts.email) });
	const clock = manualTimers(FAKE_AI_RESET - 10 * 3_600_000);
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		debounceMs: 0,
		deviceLocales: () => ["pt-BR"],
	});
	const sync = createSyncController({
		store,
		sessionStorage: createMemoryStorage(),
		fetch: cloud.fetch,
		intervalMs: 0,
		debounceMs: 60_000,
		timers: clock.timers,
	});
	const account = createAccountController({ sync, cache: createMemoryStorage(), store });
	let locale: Locale = "en";
	const ai = createAiClient({
		store,
		sync,
		account,
		isOnline: opts.online ?? (() => true),
		locale: () => locale,
		timers: clock.timers,
	});
	const settle = async () => {
		for (let i = 0; i < 20 && account.getState().status === "loading"; i++) await flush(2);
		await flush(4);
	};
	return {
		cloud,
		clock,
		store,
		sync,
		account,
		ai,
		settle,
		setLocale: (next: Locale) => {
			locale = next;
		},
		async signUp() {
			await sync.signUp(FAKE_URL, "Ana", "ana@example.com", "secret123");
			await settle();
		},
		async consent(translate = false) {
			await account.setAiConsent({ suggestions: true, translate });
			await settle();
		},
	};
}

const ACCOUNT = {
	id: "u1",
	email: "ana@example.com",
	name: "Ana",
	emailVerified: true,
	ai: { consentAt: 1, translate: false },
} as unknown as AccountInfo;

describe("availability matrix (Annex C §1.6)", () => {
	const server = v2ServerInfo(meta({}, true));
	const cases: [string, Parameters<typeof aiStatusOf>[0], AiStatus][] = [
		["signed out", { signedIn: false, server, account: ACCOUNT, online: true }, "hidden"],
		[
			"no AI on the server",
			{ signedIn: true, server: v2ServerInfo(meta(null)), account: ACCOUNT, online: true },
			"hidden",
		],
		[
			"both features off",
			{
				signedIn: true,
				server: v2ServerInfo(meta({ suggest: false, translate: false })),
				account: ACCOUNT,
				online: true,
			},
			"hidden",
		],
		["account not loaded", { signedIn: true, server, account: null, online: true }, "hidden"],
		["offline", { signedIn: true, server, account: ACCOUNT, online: false }, "offline"],
		[
			"unverified (email on)",
			{ signedIn: true, server, account: { ...ACCOUNT, emailVerified: false }, online: true },
			"unverified",
		],
		[
			"unverified but email off (D67)",
			{
				signedIn: true,
				server: v2ServerInfo(meta({}, false)),
				account: { ...ACCOUNT, emailVerified: false },
				online: true,
			},
			"ready",
		],
		[
			"no consent",
			{
				signedIn: true,
				server,
				account: { ...ACCOUNT, ai: { consentAt: null, translate: false } },
				online: true,
			},
			"needs-consent",
		],
		["ready", { signedIn: true, server, account: ACCOUNT, online: true }, "ready"],
	];
	for (const [name, input, expected] of cases) {
		test(name, () => expect(aiStatusOf(input)).toBe(expected));
	}

	test("the client follows sign-in, the account and consent; Beta from the server", async () => {
		const t = await setup();
		expect(t.ai.availability().status).toBe("hidden");
		const seen: string[] = [];
		t.ai.subscribe(() => seen.push(t.ai.availability().status));
		await t.signUp();
		expect(t.ai.availability()).toMatchObject({
			status: "needs-consent",
			beta: true,
			suggest: true,
			translateFeature: true,
			translateOn: false,
			translating: false,
		});
		await t.consent(true);
		expect(t.ai.availability()).toMatchObject({ status: "ready", translating: true });
		expect(seen.at(-1)).toBe("ready");
		// Stable reference while nothing changes (useSyncExternalStore).
		expect(t.ai.availability()).toBe(t.ai.availability());
		await t.sync.signOut();
		await t.settle();
		expect(t.ai.availability().status).toBe("hidden");
	});

	test("no AI on the server: hidden, and suggest refuses without a request", async () => {
		const t = await setup({ ai: null });
		await t.signUp();
		expect(t.ai.availability().status).toBe("hidden");
		await expect(t.ai.suggest("habit.name", { kind: "build" }, "pt-BR")).rejects.toMatchObject({
			kind: "disabled",
		});
		expect(t.cloud.aiCalls).toHaveLength(0);
	});

	test("unverified when the server requires it and email is on", async () => {
		const t = await setup({ email: true });
		await t.signUp();
		await t.consent();
		expect(t.ai.availability().status).toBe("unverified");
		await expect(t.ai.suggest("habit.name", { kind: "build" }, "pt-BR")).rejects.toMatchObject({
			kind: "unverified",
		});
	});

	test("offline: disabled sparkle; refresh re-reads connectivity", async () => {
		let online = false;
		const t = await setup({ online: () => online });
		await t.signUp();
		await t.consent();
		expect(t.ai.availability().status).toBe("offline");
		await expect(t.ai.suggest("habit.name", { kind: "build" }, "en")).rejects.toMatchObject({
			kind: "offline",
		});
		online = true;
		t.ai.refresh();
		expect(t.ai.availability().status).toBe("ready");
	});
});

describe("suggest", () => {
	test("posts the request, parses the output, reports the quota and caches in memory", async () => {
		const t = await setup();
		await t.signUp();
		await t.consent();
		const answer = await t.ai.suggest("habit.twoMinute", { habit: "Ler", kind: "build" }, "pt-BR");
		expect(answer.output.items).toEqual(["Ler 1 página", "Ler no ônibus"]);
		expect(answer.quota).toEqual({ limit: 10, remaining: 9, resetsAt: FAKE_AI_RESET });
		expect(t.cloud.aiCalls).toEqual([
			{
				procedure: "ai.suggest",
				body: { kind: "habit.twoMinute", locale: "pt-BR", input: { habit: "Ler", kind: "build" } },
			},
		]);
		expect(t.ai.availability().quota.suggest?.remaining).toBe(9);

		// Same kind, locale and input (key order doesn't matter): served from memory.
		await t.ai.suggest("habit.twoMinute", { kind: "build", habit: "Ler" }, "pt-BR");
		expect(t.cloud.aiCalls).toHaveLength(1);
		// Another locale or input: a new call; `fresh` skips the cache.
		await t.ai.suggest("habit.twoMinute", { habit: "Ler", kind: "build" }, "en");
		await t.ai.suggest("habit.twoMinute", { habit: "Ler", kind: "build" }, "pt-BR", {
			fresh: true,
		});
		expect(t.cloud.aiCalls).toHaveLength(3);
		// Every request carries the bearer and never puts content in the URL.
		const request = t.cloud.requests.find((r) => r.path.startsWith("/trpc/ai.suggest"));
		expect(request?.method).toBe("POST");
		expect(request?.path).toBe("/trpc/ai.suggest");
	});

	test("LRU of `cacheSize` answers; cleared for another account", async () => {
		const t = await setup();
		await t.signUp();
		await t.consent();
		const small = createAiClient({
			store: t.store,
			sync: t.sync,
			account: t.account,
			isOnline: () => true,
			timers: t.clock.timers,
			cacheSize: 2,
		});
		const ask = (goal: string) => small.suggest("identity.statement", { goal }, "en");
		await ask("ler mais");
		await ask("correr");
		await ask("ler mais"); // hit: now most recent
		await ask("meditar"); // evicts "correr"
		expect(t.cloud.aiCalls).toHaveLength(3);
		await ask("ler mais");
		expect(t.cloud.aiCalls).toHaveLength(3);
		await ask("correr");
		expect(t.cloud.aiCalls).toHaveLength(4);

		await t.sync.signOut();
		await t.sync.signUp(FAKE_URL, "Bia", "bia@example.com", "secret123");
		await t.settle();
		await t.account.setAiConsent({ suggestions: true, translate: false });
		await t.settle();
		await ask("ler mais");
		expect(t.cloud.aiCalls).toHaveLength(5);
	});

	test("a malformed output is `failed`", async () => {
		const t = await setup();
		await t.signUp();
		await t.consent();
		t.cloud.aiSuggest = () => ({ items: [] });
		await expect(t.ai.suggest("habit.name", { kind: "build" }, "en")).rejects.toMatchObject({
			kind: "failed",
		});
	});

	test("quota: refused until `resetsAt`, without calling the server", async () => {
		const t = await setup();
		await t.signUp();
		await t.consent();
		t.cloud.aiLimit.suggest = 1;
		await t.ai.suggest("identity.statement", { goal: "um" }, "en");
		const error = await t.ai.suggest("identity.statement", { goal: "dois" }, "en").catch((e) => e);
		expect(error).toBeInstanceOf(AiError);
		expect(error).toMatchObject({ kind: "quota", resetsAt: FAKE_AI_RESET });
		expect(aiErrorKey(error)).toBe("ai.error.quota");
		expect(t.ai.availability().blockedUntil.suggest).toBe(FAKE_AI_RESET);
		const calls = t.cloud.aiCalls.length;
		await expect(t.ai.suggest("identity.statement", { goal: "três" }, "en")).rejects.toMatchObject({
			kind: "quota",
		});
		expect(t.cloud.aiCalls).toHaveLength(calls);
		// An answer already in memory is free: still served while blocked; "Try others" isn't.
		const cached = await t.ai.suggest("identity.statement", { goal: "um" }, "en");
		expect(cached.output.items.length).toBeGreaterThan(0);
		await expect(
			t.ai.suggest("identity.statement", { goal: "um" }, "en", { fresh: true }),
		).rejects.toMatchObject({ kind: "quota" });
		expect(t.cloud.aiCalls).toHaveLength(calls);
		// After the reset the server is asked again.
		t.cloud.aiUsed.suggest = 0;
		await t.clock.advance(10 * 3_600_000);
		await t.ai.suggest("identity.statement", { goal: "três" }, "en");
		expect(t.ai.availability().blockedUntil.suggest).toBeNull();
	});

	test("timeout follows `features.ai.timeoutMs + 5 s`; a canceled call is `aborted`", async () => {
		const t = await setup({ ai: { timeoutMs: 1_000 } });
		await t.signUp();
		await t.consent();
		t.cloud.aiHang = true;
		let settled: unknown = null;
		const pending = t.ai.suggest("habit.name", { kind: "build" }, "en").catch((e) => {
			settled = e;
		});
		await t.clock.advance(5_999);
		expect(settled).toBeNull();
		await t.clock.advance(1);
		await pending;
		expect(settled).toMatchObject({ kind: "timeout" });

		const controller = new AbortController();
		const canceled = t.ai
			.suggest("habit.name", { kind: "break" }, "en", { signal: controller.signal })
			.catch((e) => e);
		await flush(2);
		controller.abort();
		const error = await canceled;
		expect(error).toMatchObject({ kind: "aborted" });
		expect(aiErrorKey(error)).toBeNull();
	});

	test("server refusals map to error kinds", async () => {
		const t = await setup();
		await t.signUp();
		await t.consent();
		const cases: [number, string, Record<string, unknown> | undefined, AiErrorKind][] = [
			[429, "TOO_MANY_REQUESTS", { reason: "rate", retryAt: 123 }, "busy"],
			[503, "SERVICE_UNAVAILABLE", { reason: "busy" }, "busy"],
			[504, "GATEWAY_TIMEOUT", { reason: "timeout" }, "timeout"],
			[502, "BAD_GATEWAY", { reason: "failed" }, "failed"],
			[501, "NOT_IMPLEMENTED", undefined, "disabled"],
			[400, "BAD_REQUEST", undefined, "failed"],
		];
		let n = 0;
		for (const [status, code, atomic, kind] of cases) {
			t.cloud.failNext("/trpc/ai.suggest", status, {
				error: { message: code, code: -32000, data: { code, httpStatus: status, atomic } },
			});
			await expect(
				t.ai.suggest("identity.statement", { goal: `goal ${n++}` }, "en"),
			).rejects.toMatchObject({ kind });
		}
		t.cloud.offline = true;
		await expect(
			t.ai.suggest("identity.statement", { goal: "offline" }, "en"),
		).rejects.toMatchObject({ kind: "offline" });
		t.cloud.offline = false;
	});

	test("consent withdrawn elsewhere: `consent`, and the account refreshes to needs-consent", async () => {
		const t = await setup();
		await t.signUp();
		await t.consent();
		t.cloud.consent = null;
		const error = await t.ai.suggest("habit.name", { kind: "build" }, "en").catch((e) => e);
		expect(error).toMatchObject({ kind: "consent" });
		expect(aiErrorKey(error)).toBeNull();
		await t.settle();
		expect(t.ai.availability().status).toBe("needs-consent");
	});

	test("aiErrorFrom and aiErrorKey", () => {
		const remote = (status: number, reason?: string, retryAt?: number) =>
			new RemoteError("x", status, undefined, {
				...(reason ? { reason } : {}),
				...(retryAt ? { retryAt } : {}),
			});
		expect(aiErrorFrom(remote(429, "quota", 5))).toMatchObject({ kind: "quota", resetsAt: 5 });
		expect(aiErrorFrom(remote(412, "unverified")).kind).toBe("unverified");
		expect(aiErrorFrom(remote(412, "consent")).kind).toBe("consent");
		expect(aiErrorFrom(remote(401)).kind).toBe("auth");
		expect(aiErrorFrom(new TypeError("fetch failed")).kind).toBe("offline");
		expect(aiErrorFrom(new DOMException("x", "AbortError")).kind).toBe("timeout");
		expect(aiErrorFrom(new Error("x"), { canceled: true }).kind).toBe("aborted");
		expect(aiErrorKey(new AiError("busy"))).toBe("ai.error.busy");
		expect(aiErrorKey(new AiError("offline"))).toBe("ai.error.offline");
		expect(aiErrorKey(new AiError("timeout"))).toBe("ai.error.timeout");
		expect(aiErrorKey(new AiError("unverified"))).toBe("ai.error.unverified");
		expect(aiErrorKey(new AiError("failed"))).toBe("ai.error.failed");
		expect(aiErrorKey(new AiError("auth"))).toBe("account.errors.sessionEnded");
		expect(aiErrorKey(new AiError("disabled"))).toBeNull();
		expect(aiErrorKey(new Error("?"))).toBe("ai.error.failed");
	});
});

describe("translation runner (Annex C §1.8)", () => {
	async function translating() {
		const t = await setup();
		await t.signUp();
		const { actions } = t.store.getState();
		const a = actions.createHabit({ name: "Meditar no quintal" });
		const b = actions.createHabit({ name: "Tocar violão 15 min" });
		actions.createHabit({ name: "Ler 10 páginas" }); // phrasebook: never sent
		await t.consent(true);
		return { ...t, a, b };
	}

	test("runs only after a completed pull and never re-translates unchanged text", async () => {
		const t = await translating();
		const stop = t.ai.startTranslationRunner();
		expect(t.cloud.aiCalls).toHaveLength(0);

		await t.sync.syncNow();
		await flush(10);
		const calls = t.cloud.aiCalls.filter((c) => c.procedure === "ai.translate");
		expect(calls).toHaveLength(1);
		expect((calls[0]?.body.items as { text: string }[]).map((i) => i.text)).toEqual([
			"Meditar no quintal",
			"Tocar violão 15 min",
		]);
		expect(calls[0]?.body.target).toBe("en");
		const doc = t.store.getState().data.translations[translationId("habits", t.a.id, "en")];
		expect(doc?.fields.name).toEqual({
			text: "[en] Meditar no quintal",
			src: textHash("Meditar no quintal"),
		});
		expect(t.ai.availability().quota.translate?.remaining).toBe(2000 - 37);

		// Another round: nothing new to translate.
		await t.sync.syncNow();
		await flush(10);
		expect(t.cloud.aiCalls.filter((c) => c.procedure === "ai.translate")).toHaveLength(1);
		// An edit: only that text goes again.
		t.store.getState().actions.updateHabit(t.b.id, { name: "Tocar violão 20 min" });
		await t.sync.syncNow();
		await flush(10);
		const last = t.cloud.aiCalls.at(-1);
		expect((last?.body.items as { text: string }[]).map((i) => i.text)).toEqual([
			"Tocar violão 20 min",
		]);
		stop();
	});

	test("a locale change translates 3 s later", async () => {
		const t = await translating();
		const stop = t.ai.startTranslationRunner();
		await t.sync.syncNow();
		await flush(10);
		const before = t.cloud.aiCalls.length;
		t.setLocale("pt-BR");
		t.store.getState().actions.updateSettings({ locale: "pt-BR" });
		t.store.getState().actions.createHabit({ name: "Walk the dog after dinner", lang: "en" });
		await t.clock.advance(2_999);
		expect(t.cloud.aiCalls).toHaveLength(before);
		await t.clock.advance(1);
		await flush(10);
		const last = t.cloud.aiCalls.at(-1);
		expect(last?.body.target).toBe("pt-BR");
		expect((last?.body.items as { text: string }[]).map((i) => i.text)).toEqual([
			"Walk the dog after dinner",
		]);
		stop();
	});

	test("stops on quota until `resetsAt`, then resumes", async () => {
		const t = await translating();
		t.cloud.aiLimit.translate = 10;
		const stop = t.ai.startTranslationRunner();
		await t.sync.syncNow();
		await flush(10);
		expect(t.cloud.aiCalls.filter((c) => c.procedure === "ai.translate")).toHaveLength(1);
		expect(t.ai.availability().blockedUntil.translate).toBe(FAKE_AI_RESET);
		expect(Object.keys(t.store.getState().data.translations)).toHaveLength(0);

		await t.sync.syncNow();
		await flush(10);
		expect(t.cloud.aiCalls.filter((c) => c.procedure === "ai.translate")).toHaveLength(1);
		expect(await t.ai.translateOnce()).toBe(0);

		t.cloud.aiLimit.translate = 2000;
		await t.clock.advance(10 * 3_600_000);
		await t.sync.syncNow();
		await flush(10);
		expect(t.cloud.aiCalls.filter((c) => c.procedure === "ai.translate")).toHaveLength(2);
		expect(Object.keys(t.store.getState().data.translations)).toHaveLength(2);
		stop();
	});

	test("off without the account switch; turning it off clears every translation", async () => {
		const t = await setup();
		await t.signUp();
		t.store.getState().actions.createHabit({ name: "Meditar no quintal" });
		await t.consent(false);
		expect(t.ai.availability().translating).toBe(false);
		expect(await t.ai.translateOnce()).toBe(0);
		expect(t.cloud.aiCalls).toHaveLength(0);

		const stop = t.ai.startTranslationRunner();
		await t.sync.syncNow();
		await flush(10);
		// Turned on after a completed pull: runs at once.
		await t.consent(true);
		await flush(10);
		expect(t.cloud.aiCalls.filter((c) => c.procedure === "ai.translate")).toHaveLength(1);
		expect(Object.values(t.store.getState().data.translations).some((d) => !d.deletedAt)).toBe(
			true,
		);
		await t.consent(false);
		expect(Object.values(t.store.getState().data.translations).every((d) => d.deletedAt)).toBe(
			true,
		);
		stop();
	});

	test("never sends the journal (D19)", async () => {
		const t = await translating();
		t.store.getState().actions.createJournalEntry({
			kind: "note",
			answers: { text: "Um segredo muito pessoal" },
		});
		expect(await t.ai.translateOnce()).toBe(2);
		const sent = JSON.stringify(t.cloud.aiCalls);
		expect(sent).not.toContain("segredo");
		expect(resolveLocale("system", [])).toBe("en");
	});
});
