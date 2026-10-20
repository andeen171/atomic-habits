import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	type AtomicStore,
	type SyncTransport,
	type WireSyncRecord,
	createAtomicStore,
	createMemoryStorage,
	runSync,
} from "@atomic/core";
import { type TestApp, pullOk, pushOk, setupApp, signUp } from "./helpers";

/**
 * Equal-stamp ties between the real server and a v2 client (amends D45,
 * Phase 1A reverify). The server orders two versions with the same
 * `updatedAt` by the canonical JSON of what was pushed (the wire form); the
 * client must decide on exactly that, not on its normalized copy, or it keeps
 * its own version, clears the key and stays out of step for good.
 */

const T0 = 1_760_000_000_000;
/** The stored version's stamp: ahead of the device clock, so an edit stamps T + 1. */
const T = T0 + 2_000_000;

/** A habit as a v1 build writes it: none of the fields v2 adds (emojiAuto, goalHistory, …). */
const v1Habit = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: "h1",
	createdAt: T0,
	updatedAt: T,
	deletedAt: null,
	name: "Read",
	emoji: "📖",
	color: "ember",
	kind: "build",
	identityId: null,
	target: 1,
	unit: null,
	schedule: { type: "daily" },
	timeOfDay: "anytime",
	cueTime: null,
	cueLocation: null,
	stackAfter: null,
	bundle: null,
	twoMinute: null,
	reward: null,
	environment: null,
	why: null,
	reminder: false,
	startDate: "2025-01-01",
	archivedAt: null,
	order: 0,
	...patch,
});

const wire = (data: Record<string, unknown>): WireSyncRecord => ({
	collection: "habits",
	id: data.id as string,
	updatedAt: data.updatedAt as number,
	deletedAt: (data.deletedAt as number | null) ?? null,
	data,
});

let app: TestApp;
beforeAll(async () => {
	app = await setupApp();
});
let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

async function account() {
	const { token } = await signUp(app);
	const transport: SyncTransport = {
		push: (input) => pushOk(app, token, input.records) as ReturnType<SyncTransport["push"]>,
		pull: (input) => pullOk(app, token, input),
	};
	const stored = async () =>
		(await pullOk(app, token, { cursor: 0 })).records.find((r) => r.id === "h1")?.data;
	return { token, transport, stored };
}

function device(): AtomicStore {
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: () => T0 + 1_000_000,
		debounceMs: 0,
	});
	store.getState().actions.setTracking(true);
	return store;
}

describe("equal stamps: the client decides like the server (wire form)", () => {
	test("a v1 and a v2 device edit an older build's document to the same stamp: both end on the server's version", async () => {
		const { token, transport, stored } = await account();
		const raw = v1Habit();
		await pushOk(app, token, [wire(raw)]);
		const b = device();
		await runSync(b, transport);
		expect(b.getState().data.habits.h1?.updatedAt).toBe(T);

		// Device A (v1: prev + 1) pushes first; device B (v2) edits to the same stamp.
		await pushOk(app, token, [wire({ ...raw, timeOfDay: "evening", updatedAt: T + 1 })]);
		b.getState().actions.updateHabit("h1", { timeOfDay: "morning" });
		expect(b.getState().data.habits.h1?.updatedAt).toBe(T + 1);

		await runSync(b, transport);
		await runSync(b, transport);
		expect((await stored())?.timeOfDay).toBe("evening");
		expect(b.getState().data.habits.h1?.timeOfDay).toBe("evening");
		expect(b.getState().sync.pending).toEqual({});
	});

	test("the v2 device's edit wins when the server ranks it first, and reaches the server", async () => {
		const { token, transport, stored } = await account();
		const raw = v1Habit();
		await pushOk(app, token, [wire(raw)]);
		const b = device();
		await runSync(b, transport);
		// The two versions first differ at "bundle", where B's sorts after the stored one's.
		await pushOk(app, token, [wire({ ...raw, bundle: "aaa", updatedAt: T + 1 })]);
		b.getState().actions.updateHabit("h1", { bundle: "zzz" });
		await runSync(b, transport);
		await runSync(b, transport);
		expect((await stored())?.bundle).toBe("zzz");
		expect(b.getState().data.habits.h1?.bundle).toBe("zzz");
		expect(b.getState().sync.pending).toEqual({});
	});

	test("a later version at the same stamp replaces a copy the device isn't changing", async () => {
		const { token, transport, stored } = await account();
		// The v1 default icon: the device derives its own (🌱), so its normalized copy
		// doesn't compare the way the stored document does.
		const raw = v1Habit({ emoji: "✨" });
		await pushOk(app, token, [wire(raw)]);
		const b = device();
		await runSync(b, transport);
		await pushOk(app, token, [wire({ ...raw, timeOfDay: "evening", updatedAt: T + 1 })]);
		await runSync(b, transport);
		expect(b.getState().data.habits.h1).toMatchObject({ timeOfDay: "evening", emoji: "🌱" });
		// Another v1 device's edit to the same stamp wins on the server.
		const output = await pushOk(app, token, [
			wire({ ...raw, timeOfDay: "morning", updatedAt: T + 1 }),
		]);
		expect(output.accepted).toBe(1);
		await runSync(b, transport);
		expect((await stored())?.timeOfDay).toBe("morning");
		expect(b.getState().data.habits.h1).toMatchObject({ timeOfDay: "morning", emoji: "🌱" });
		expect(b.getState().sync.pending).toEqual({});
	});
});
