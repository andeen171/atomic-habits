import { describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en";
import { type Task, taskSchema } from "../src/model";
import {
	SETUP_FIELDS,
	type SetupTaskDraft,
	pruneSetupDrafts,
	resolveSetupDrafts,
	setupFieldsFor,
	setupTaskPrefill,
	setupTitleUpdate,
	suggestRepeatFromText,
} from "../src/setup";

const TODAY = "2026-10-14"; // Wednesday

describe("setupFieldsFor", () => {
	test("build: environment (law 1); break: environment, twoMinute (3), reward (4)", () => {
		expect(setupFieldsFor("build")).toEqual([
			{ field: "environment", law: 1, labelKey: "form.environment" },
		]);
		expect(setupFieldsFor("break")).toEqual([
			{ field: "environment", law: 1, labelKey: "form.invisible" },
			{ field: "twoMinute", law: 3, labelKey: "form.difficult" },
			{ field: "reward", law: 4, labelKey: "form.unsatisfying" },
		]);
		for (const kind of ["build", "break"] as const) {
			for (const spec of setupFieldsFor(kind)) {
				expect(SETUP_FIELDS).toContain(spec.field);
				expect(spec.labelKey in en).toBe(true);
			}
		}
	});
});

describe("suggestRepeatFromText", () => {
	test("daily phrases in en and pt (accents included)", () => {
		for (const text of [
			"Book on my pillow every morning",
			"Water bottle always on my desk",
			"Lay out clothes every night",
			"Charge the phone each night",
			"Stretch everyday",
			"Daily review",
			"Nightly reset",
			"Livro no travesseiro toda manhã",
			"Garrafa na mesa toda manha",
			"Arrumar a mesa todo dia",
			"Ler todos os dias",
			"Celular fora do quarto sempre",
			"Revisar diariamente",
		]) {
			expect({ text, repeat: suggestRepeatFromText(text) }).toEqual({ text, repeat: "daily" });
		}
	});

	test("weekly phrases, and one-off for everything else", () => {
		for (const text of [
			"Plan meals every week",
			"Weekly review",
			"Faxina toda semana",
			"Revisar semanalmente",
		]) {
			expect({ text, repeat: suggestRepeatFromText(text) }).toEqual({ text, repeat: "weekly" });
		}
		for (const text of [
			"Gym bag packed by the door",
			"Delete saved cards from apps",
			"Every",
			"",
			"Everything ready",
		]) {
			expect({ text, repeat: suggestRepeatFromText(text) }).toEqual({ text, repeat: null });
		}
	});
});

describe("setupTaskPrefill", () => {
	const reader = {
		id: "h1",
		kind: "build" as const,
		schedule: { type: "daily" as const },
		environment: "  book on my pillow every morning ",
		twoMinute: "Read one page",
	};

	test("the field text as title, the repeat from the heuristic, starting today", () => {
		expect(setupTaskPrefill(reader, "environment", TODAY, 1)).toEqual({
			title: "Book on my pillow every morning",
			habitId: "h1",
			law: 1,
			habitField: "environment",
			repeat: { type: "days", every: 1, until: null, count: null, endedAt: null },
			date: TODAY,
		});
		const weekly = setupTaskPrefill(
			{ ...reader, environment: "Fresh flowers every week" },
			"environment",
			TODAY,
			0,
		);
		expect(weekly?.repeat).toMatchObject({ type: "weeks", days: [3], weekStart: 0 });
		const once = setupTaskPrefill(
			{ ...reader, environment: "Gym bag packed by the door" },
			"environment",
			TODAY,
			1,
		);
		expect(once?.repeat).toBeNull();
	});

	test("null for empty or non-convertible fields; break fields map to their laws", () => {
		expect(setupTaskPrefill({ ...reader, environment: "  " }, "environment", TODAY, 1)).toBeNull();
		expect(setupTaskPrefill(reader, "twoMinute", TODAY, 1)).toBeNull(); // build twoMinute isn't convertible
		const doom = {
			id: "h2",
			kind: "break" as const,
			schedule: { type: "daily" as const },
			twoMinute: "log out after each use",
			reward: "Tell Ana about every slip",
		};
		expect(setupTaskPrefill(doom, "twoMinute", TODAY, 1)).toMatchObject({
			title: "Log out after each use",
			law: 3,
			repeat: null,
		});
		expect(setupTaskPrefill(doom, "reward", TODAY, 1)).toMatchObject({
			law: 4,
			habitField: "reward",
		});
		const long = setupTaskPrefill(
			{ ...reader, environment: "x".repeat(400) },
			"environment",
			TODAY,
			1,
		);
		expect(long?.title).toHaveLength(280);
	});
});

const draft = (partial: Partial<SetupTaskDraft>): SetupTaskDraft => ({
	key: partial.key ?? "d",
	field: null,
	law: 1,
	title: null,
	repeat: null,
	date: TODAY,
	...partial,
});

describe("drafts", () => {
	test("pruneSetupDrafts drops non-convertible fields on a kind change; free-form drafts stay for every law", () => {
		const drafts = [
			draft({ key: "env", field: "environment" }),
			draft({ key: "two", field: "twoMinute", law: 3 }),
			draft({ key: "rew", field: "reward", law: 4 }),
			...([1, 2, 3, 4] as const).map((law) => draft({ key: `free${law}`, law, title: "Do it" })),
		];
		expect(pruneSetupDrafts(drafts, "build").map((d) => d.key)).toEqual([
			"env",
			"free1",
			"free2",
			"free3",
			"free4",
		]);
		expect(pruneSetupDrafts(drafts, "break")).toHaveLength(7);
	});

	test("resolveSetupDrafts follows the field text, uses overrides, trims, capitalizes and drops empties", () => {
		const repeat = { type: "days" as const, every: 1, until: null, count: null, endedAt: null };
		const inputs = resolveSetupDrafts(
			[
				draft({ key: "env", field: "environment", repeat }),
				draft({ key: "two", field: "twoMinute", law: 3, title: "  unplug the TV " }),
				draft({ key: "rew", field: "reward", law: 4 }),
				draft({ key: "free", law: 2, title: "  " }),
				draft({ key: "free2", law: 4, title: "ask Ana to check in" }),
			],
			{ environment: "  phone in the kitchen ", reward: "" },
			"break",
		);
		expect(inputs).toEqual([
			{ title: "Phone in the kitchen", law: 1, habitField: "environment", repeat, date: TODAY },
			{ title: "Unplug the TV", law: 3, habitField: "twoMinute", repeat: null, date: TODAY },
			{ title: "Ask Ana to check in", law: 4, habitField: null, repeat: null, date: TODAY },
		]);
		// Build habits drop drafts of break-only fields.
		expect(
			resolveSetupDrafts([draft({ field: "twoMinute", law: 3, title: "x" })], {}, "build"),
		).toEqual([]);
	});
});

describe("setupTitleUpdate", () => {
	const linked = (partial: Partial<Task>): Task =>
		taskSchema.parse({
			id: "t1",
			title: "Book on my pillow",
			createdAt: 1,
			updatedAt: 1,
			habitId: "h1",
			habitField: "environment",
			law: 1,
			...partial,
		});
	const reader = { id: "h1", kind: "build" as const };

	test("offers the new title for the live linked task", () => {
		expect(setupTitleUpdate(reader, "environment", "book on the nightstand", [linked({})])).toEqual(
			{
				taskId: "t1",
				title: "Book on the nightstand",
			},
		);
		// Records work too, and the open task wins over a completed one.
		const tasks = { t1: linked({ completedAt: 5 }), t2: linked({ id: "t2", createdAt: 0 }) };
		expect(setupTitleUpdate(reader, "environment", "x", tasks)?.taskId).toBe("t2");
	});

	test("null when nothing is linked, the text is empty, or the title wouldn't change", () => {
		expect(setupTitleUpdate(reader, "environment", "Anything", [])).toBeNull();
		expect(
			setupTitleUpdate(reader, "environment", "Anything", [linked({ deletedAt: 3 })]),
		).toBeNull();
		expect(
			setupTitleUpdate(reader, "environment", "Anything", [linked({ habitId: "h9" })]),
		).toBeNull();
		expect(setupTitleUpdate(reader, "environment", "  ", [linked({})])).toBeNull();
		expect(setupTitleUpdate(reader, "environment", " book on my pillow", [linked({})])).toBeNull();
		expect(setupTitleUpdate(reader, "reward", "x", [linked({ habitField: "reward" })])).toBeNull();
	});
});
