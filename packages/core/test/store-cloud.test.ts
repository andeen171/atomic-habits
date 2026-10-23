import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import {
	PLANS,
	SERVER_API_VERSION,
	accountInfoSchema,
	formatOffer,
	nextUtcMidnight,
	serverInfoSchema,
	sessionInfoSchema,
} from "../src/account";
import { TRANSLATABLE_COLLECTIONS } from "../src/actions/cloud";
import {
	AI_SUGGEST_KINDS,
	aiQuotaSchema,
	aiSuggestInputSchemas,
	aiSuggestOutputSchemas,
	aiSuggestRequestSchema,
	aiTranslateOutputSchema,
	aiTranslateRequestSchema,
} from "../src/ai";
import { DEFAULT_SETTINGS, type Translation, translationId } from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, type CommitEvent, createAtomicStore } from "../src/store";
import type { SyncTransport } from "../src/sync";
import { runSync } from "../src/sync-engine";
import { fakeSyncServer, wire } from "./support/sync-server";

/**
 * Annex C §8 store additions (translations, lang, clearLocalData) and the
 * client/server contracts of `account.ts` and `ai.ts` (spec §3.1, Amends C).
 */

const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const DAY = 86_400_000;

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

function makeStore(clock = { now: NOW }, locales: readonly string[] = ["pt-BR"]): AtomicStore {
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: () => clock.now,
		debounceMs: 0,
		deviceLocales: () => locales,
	});
	store.getState().actions.setTracking(true);
	return store;
}

const translationOf = (store: AtomicStore, id: string) =>
	store.getState().data.translations[id] as Translation;
const SRC = "a1b2c3d4";

describe("translation actions (Annex C §3.2)", () => {
	test("applyTranslations writes one deterministic, pending document per target and locale", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		const habit = actions.createHabit({ name: "Ler 10 páginas", cueLocation: "No sofá" });
		const events: CommitEvent[] = [];
		store.subscribeCommits((e) => events.push(e));
		const written = actions.applyTranslations([
			{
				collection: "habits",
				id: habit.id,
				field: "name",
				src: SRC,
				locale: "en",
				text: " Read 10 pages ",
			},
			{
				collection: "habits",
				id: habit.id,
				field: "cueLocation",
				src: "00000000",
				locale: "en",
				text: "On the couch",
			},
			{
				collection: "habits",
				id: habit.id,
				field: "name",
				src: SRC,
				locale: "es",
				text: "Leer 10 páginas",
			},
		]);
		expect(written).toBe(2);
		const id = translationId("habits", habit.id, "en");
		expect(translationOf(store, id)).toMatchObject({
			id,
			targetCollection: "habits",
			targetId: habit.id,
			locale: "en",
			via: "ai",
			fields: {
				name: { text: "Read 10 pages", src: SRC },
				cueLocation: { text: "On the couch", src: "00000000" },
			},
			createdAt: NOW,
			deletedAt: null,
		});
		expect(store.getState().sync.pending[`translations/${id}`]).toBe(true);
		expect(events.map((e) => e.origin)).toEqual(["derived"]);

		// Unchanged fields aren't rewritten; a new field merges into the same document.
		const before = translationOf(store, id);
		expect(
			actions.applyTranslations([
				{
					collection: "habits",
					id: habit.id,
					field: "name",
					src: SRC,
					locale: "en",
					text: "Read 10 pages",
				},
			]),
		).toBe(0);
		expect(translationOf(store, id)).toBe(before);
		clock.now += 1_000;
		actions.applyTranslations([
			{
				collection: "habits",
				id: habit.id,
				field: "why",
				src: "ffffffff",
				locale: "en",
				text: "Calm",
			},
		]);
		expect(Object.keys(translationOf(store, id).fields).sort()).toEqual([
			"cueLocation",
			"name",
			"why",
		]);
		expect(translationOf(store, id).updatedAt).toBe(clock.now);
	});

	test("never the journal or tracker entries (D19); empty texts and bad hashes are ignored", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const entry = actions.createJournalEntry({ kind: "note", answers: { text: "Privado" } });
		expect(TRANSLATABLE_COLLECTIONS).toEqual(["habits", "identities", "tasks", "scorecard"]);
		expect(
			actions.applyTranslations([
				{
					collection: "journal",
					id: entry.id,
					field: "text",
					src: SRC,
					locale: "en",
					text: "Private",
				},
				{
					collection: "trackerEntries",
					id: "e1",
					field: "note",
					src: SRC,
					locale: "en",
					text: "Lunch",
				},
				{ collection: "habits", id: "h1", field: "name", src: "short", locale: "en", text: "Read" },
				{ collection: "habits", id: "h1", field: "name", src: SRC, locale: "en", text: "   " },
			]),
		).toBe(0);
		expect(store.getState().data.translations).toEqual({});
	});

	test("clearTranslations tombstones every live document; applyTranslations revives one", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		const identity = actions.createIdentity({ statement: "Sou leitor" });
		actions.applyTranslations([
			{
				collection: "identities",
				id: identity.id,
				field: "statement",
				src: SRC,
				locale: "en",
				text: "I read",
			},
		]);
		const id = translationId("identities", identity.id, "en");
		clock.now += 1_000;
		actions.clearTranslations();
		expect(translationOf(store, id).deletedAt).toBe(clock.now);
		const tomb = translationOf(store, id);
		actions.clearTranslations(); // nothing live: no write
		expect(translationOf(store, id)).toBe(tomb);
		clock.now += 1_000;
		actions.applyTranslations([
			{
				collection: "identities",
				id: identity.id,
				field: "statement",
				src: SRC,
				locale: "en",
				text: "I read",
			},
		]);
		expect(translationOf(store, id)).toMatchObject({ deletedAt: null, createdAt: NOW });
	});

	test("pruneTranslations tombstones translations of deleted targets, at most once a day", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		const kept = actions.createTask({ title: "Comprar pão" });
		const gone = actions.createTask({ title: "Ligar" });
		const write = (collection: string, id: string) => ({
			collection,
			id,
			field: "title",
			src: SRC,
			locale: "en",
			text: "Text",
		});
		actions.applyTranslations([
			write("tasks", kept.id),
			write("tasks", gone.id),
			write("tasks", "missing"),
		]);
		// A target collection this build doesn't know (written by a newer one) is kept.
		store.setState((s) => ({
			data: {
				...s.data,
				translations: {
					...s.data.translations,
					"rituals:r1:en": {
						...(translationOf(store, translationId("tasks", kept.id, "en")) as Translation),
						id: "rituals:r1:en",
						targetCollection: "rituals",
						targetId: "r1",
					},
				},
			},
		}));
		actions.deleteTask(gone.id);
		clock.now += 1_000;
		expect(actions.pruneTranslations()).toBe(1);
		const deleted = Object.values(store.getState().data.translations)
			.filter((t) => t.deletedAt)
			.map((t) => t.targetId);
		// A target missing locally (not pulled yet) is kept.
		expect(deleted).toEqual([gone.id]);
		actions.deleteTask(kept.id);
		expect(actions.pruneTranslations()).toBe(0); // already ran today
		expect(actions.pruneTranslations({ force: true })).toBe(1);
		clock.now += DAY;
		expect(actions.pruneTranslations()).toBe(0); // runs, nothing left
		expect(translationOf(store, "rituals:r1:en").deletedAt).toBeNull();
		expect(translationOf(store, translationId("tasks", "missing", "en")).deletedAt).toBeNull();
	});

	test("a partial pull never prunes a translation whose target hasn't arrived yet", async () => {
		// The server has the translation (seq 2) before the habit it translates,
		// which was edited later (seq 3). The first pull stops after one page.
		const T = Date.now() - 60_000;
		const server = fakeSyncServer({ pageSize: 1 });
		const source = makeStore({ now: T });
		const habit = source.getState().actions.createHabit({ name: "Ler" });
		source
			.getState()
			.actions.applyTranslations([
				{ collection: "habits", id: habit.id, field: "name", src: SRC, locale: "en", text: "Read" },
			]);
		const translation = translationOf(source, translationId("habits", habit.id, "en"));
		server.put(wire("habits", habit as never));
		server.put(wire("translations", translation as never));
		server.put(wire("habits", { ...habit, name: "Ler mais", updatedAt: T + 50 } as never));

		const store = makeStore({ now: T + 100 });
		let pulls = 0;
		const flaky: SyncTransport = {
			push: server.transport.push,
			pull: async (input) => {
				if (pulls++ >= 1) throw new Error("network");
				return server.transport.pull(input);
			},
		};
		await expect(runSync(store, flaky)).rejects.toThrow("network");
		expect(translationOf(store, translation.id)).toBeDefined();
		expect(store.getState().data.habits[habit.id]).toBeUndefined(); // still on the server only
		expect(store.getState().actions.pruneTranslations({ force: true })).toBe(0);
		expect(translationOf(store, translation.id).deletedAt).toBeNull();
		expect(store.getState().sync.pending[`translations/${translation.id}`]).toBeUndefined();
		// The rest of the pull brings the habit: still kept. A tombstone prunes it.
		await runSync(store, server.transport);
		expect(store.getState().data.habits[habit.id]?.name).toBe("Ler mais");
		expect(store.getState().actions.pruneTranslations({ force: true })).toBe(0);
		store
			.getState()
			.actions.applyRemote([
				wire("habits", { ...habit, deletedAt: T + 60, updatedAt: T + 60 } as never),
			]);
		expect(store.getState().actions.pruneTranslations({ force: true })).toBe(1);
		expect(translationOf(store, translation.id).deletedAt).not.toBeNull();
	});
});

describe("store additions (Annex C §8)", () => {
	test("lang is stamped from the device locale at creation; clearLocalData keeps settings and writes no tombstones", () => {
		const store = makeStore({ now: NOW }, ["pt-BR"]);
		const { actions } = store.getState();
		actions.updateSettings({ displayName: "Ana" });
		expect(actions.createHabit({ name: "Ler" }).lang).toBe("pt-BR");
		expect(actions.createTask({ title: "Comprar" }).lang).toBe("pt-BR");
		expect(actions.createIdentity({ statement: "Sou leitor" }).lang).toBe("pt-BR");
		expect(actions.createScorecardItem({ label: "Café" }).lang).toBe("pt-BR");
		actions.clearLocalData();
		const { data, settings, sync } = store.getState();
		expect(Object.values(data).every((records) => Object.keys(records).length === 0)).toBe(true);
		expect(settings).toEqual({ ...DEFAULT_SETTINGS, displayName: "Ana" });
		expect(sync.pending).toEqual({});
		expect(sync.tracking).toBe(true);
	});
});

describe("account.ts contracts (Annex C §2.5, Amends C)", () => {
	const minimalInfo = {
		api: SERVER_API_VERSION,
		version: "2.0.0",
		collections: ["habits", "logs"],
		features: {},
	};

	test("a minimal ServerInfo gets the defaults; newer servers' fields are kept", () => {
		const info = serverInfoSchema.parse({ ...minimalInfo, region: "gru" });
		expect(info).toMatchObject({
			schemaRev: 1,
			clients: { android: null },
			features: { email: false, google: null, billing: null, ai: null, blobs: null },
			legal: { privacyUrl: null, termsUrl: null },
			region: "gru",
		});
		const full = serverInfoSchema.parse({
			...minimalInfo,
			schemaRev: 2,
			clients: { android: { version: "2.0.1", url: "https://example.com/atomic.apk" } },
			features: {
				email: true,
				ai: {
					suggest: true,
					translate: false,
					hosting: "self-hosted",
					providerName: null,
					requiresVerifiedEmail: true,
					limits: {
						free: {
							aiRequestsPerDay: 10,
							aiTranslateCharsPerDay: 2000,
							blobBytes: 1,
							blobMaxFileBytes: 1,
							syncBytes: 1,
						},
						team: {
							aiRequestsPerDay: 99,
							aiTranslateCharsPerDay: 1,
							blobBytes: 1,
							blobMaxFileBytes: 1,
							syncBytes: 1,
						},
					},
					timeoutMs: 25_000,
				},
				blobs: { maxFileBytes: 2_097_152, mimes: ["image/jpeg", "image/webp"] },
			},
		});
		expect(full.features.ai?.beta).toBe(true);
		expect(full.features.ai?.limits.team?.aiRequestsPerDay).toBe(99);
		expect(full.clients.android?.version).toBe("2.0.1");
		expect(
			serverInfoSchema.safeParse({
				...minimalInfo,
				features: { blobs: { maxFileBytes: 1, mimes: ["image/png"] } },
			}).success,
		).toBe(false);
		expect(
			serverInfoSchema.safeParse({ ...minimalInfo, features: { ai: { suggest: true } } }).success,
		).toBe(false);
	});

	test("AccountInfo and SessionInfo parse loosely; plans are closed", () => {
		const limits = {
			aiRequestsPerDay: 10,
			aiTranslateCharsPerDay: 2000,
			blobBytes: 1,
			blobMaxFileBytes: 1,
			syncBytes: 5,
		};
		const account = {
			id: "u1",
			email: "a@b.c",
			name: "Ana",
			emailVerified: true,
			createdAt: NOW,
			providers: ["credential"],
			hasPassword: true,
			ai: { consentAt: null, translate: false },
			entitlements: {
				plan: "free",
				source: "none",
				status: "none",
				renewsAt: null,
				endsAt: null,
				graceUntil: null,
				limits,
				canManageBilling: false,
			},
			usage: {
				aiRequestsToday: 0,
				aiTranslateCharsToday: 0,
				aiResetsAt: NOW,
				blobBytes: 0,
				blobCount: 0,
				syncBytes: 3,
			},
			avatar: "x",
		};
		expect(accountInfoSchema.parse(account)).toMatchObject({
			avatar: "x",
			usage: { syncBytes: 3 },
		});
		expect(
			accountInfoSchema.safeParse({
				...account,
				entitlements: { ...account.entitlements, plan: "team" },
			}).success,
		).toBe(false);
		expect(PLANS).toEqual(["free", "pro"]);
		expect(
			sessionInfoSchema.parse({
				id: "s",
				createdAt: 1,
				lastActiveAt: 2,
				device: null,
				current: true,
			}),
		).toEqual({ id: "s", createdAt: 1, lastActiveAt: 2, device: null, current: true });
	});

	test("formatOffer and nextUtcMidnight", () => {
		expect(formatOffer({ amount: 990, currency: "BRL" }, "pt-BR").replace(/\s/g, " ")).toBe(
			"R$ 9,90",
		);
		expect(formatOffer({ amount: 299, currency: "usd" }, "en")).toBe("$2.99");
		expect(formatOffer({ amount: 500, currency: "JPY" }, "en")).toBe("¥500");
		const midnight = Date.UTC(2026, 9, 21);
		expect(nextUtcMidnight(Date.UTC(2026, 9, 20, 23, 59))).toBe(midnight);
		expect(nextUtcMidnight(midnight)).toBe(midnight + DAY);
	});
});

describe("ai.ts contracts (Annex C §2.5, Amends C, D19)", () => {
	test("the kinds: no journal kind; one input and output schema each", () => {
		expect(AI_SUGGEST_KINDS).toEqual([
			"habit.name",
			"habit.twoMinute",
			"habit.intention",
			"habit.stack",
			"habit.laws",
			"habit.setupTasks",
			"identity.statement",
			"task.firstStep",
		]);
		expect(AI_SUGGEST_KINDS.some((k) => k.startsWith("journal"))).toBe(false);
		expect(Object.keys(aiSuggestInputSchemas).sort()).toEqual([...AI_SUGGEST_KINDS].sort());
		expect(Object.keys(aiSuggestOutputSchemas).sort()).toEqual([...AI_SUGGEST_KINDS].sort());
		// The server derives model JSON schemas from the outputs.
		for (const kind of AI_SUGGEST_KINDS) {
			expect(z.toJSONSchema(aiSuggestOutputSchemas[kind])).toMatchObject({ type: "object" });
		}
	});

	test("requests: discriminated by kind, locale-checked, capped", () => {
		const ok = aiSuggestRequestSchema.safeParse({
			kind: "habit.name",
			locale: "pt-BR",
			input: { partial: "Le", kind: "build" },
		});
		expect(ok.success).toBe(true);
		const bad = (request: unknown) => aiSuggestRequestSchema.safeParse(request).success;
		expect(bad({ kind: "journal.followUp", locale: "en", input: { entry: "x" } })).toBe(false);
		expect(bad({ kind: "habit.name", locale: "es", input: { kind: "build" } })).toBe(false);
		expect(
			bad({ kind: "habit.name", locale: "en", input: { partial: "x".repeat(81), kind: "build" } }),
		).toBe(false);
		expect(
			bad({
				kind: "habit.stack",
				locale: "en",
				input: { habit: "Read", anchors: Array(11).fill("a") },
			}),
		).toBe(false);
		expect(bad({ kind: "identity.statement", locale: "en", input: { goal: "x" } })).toBe(false);
		// Unknown input keys are stripped, never sent on to the model.
		expect(
			aiSuggestRequestSchema.parse({
				kind: "task.firstStep",
				locale: "en",
				input: { task: "Taxes", history: 1 },
			}).input,
		).toEqual({ task: "Taxes" });
		const items = (n: number, length: number) =>
			Array.from({ length: n }, (_, i) => ({ id: `habits:h${i}:name`, text: "x".repeat(length) }));
		expect(aiTranslateRequestSchema.safeParse({ target: "en", items: items(20, 75) }).success).toBe(
			true,
		);
		expect(aiTranslateRequestSchema.safeParse({ target: "en", items: items(21, 10) }).success).toBe(
			false,
		);
		expect(aiTranslateRequestSchema.safeParse({ target: "en", items: items(4, 400) }).success).toBe(
			false,
		);
		expect(aiTranslateRequestSchema.safeParse({ target: "en", items: [] }).success).toBe(false);
	});

	test("outputs and quotas parse loosely, with the item caps", () => {
		expect(
			aiSuggestOutputSchemas["habit.intention"].parse({
				items: [
					{
						time: "07:00",
						location: "No sofá",
						sentence: "Vou meditar às 07:00 no sofá.",
						why: "x",
					},
				],
				model: "qwen",
			}),
		).toMatchObject({ model: "qwen", items: [{ why: "x" }] });
		expect(aiSuggestOutputSchemas["habit.name"].safeParse({ items: [] }).success).toBe(false);
		expect(
			aiSuggestOutputSchemas["habit.name"].safeParse({ items: Array(6).fill("Read") }).success,
		).toBe(false);
		expect(
			aiSuggestOutputSchemas["habit.setupTasks"].safeParse({
				items: [{ title: "Clear the desk", law: 5 }],
			}).success,
		).toBe(false);
		expect(aiTranslateOutputSchema.parse({ items: [{ id: "a", text: "b" }] })).toEqual({
			items: [{ id: "a", text: "b" }],
		});
		expect(
			aiQuotaSchema.parse({ limit: 10, remaining: 3, resetsAt: NOW, plan: "free" }),
		).toMatchObject({
			remaining: 3,
		});
	});
});
