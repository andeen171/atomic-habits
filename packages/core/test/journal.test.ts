import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { sanitizeJournalAnswers, stripUnsafeText } from "../src/actions/journal";
import { type DayKey, addDays, toDayKey } from "../src/dates";
import { buildDemoData } from "../src/demo";
import { buildLogIndex, logsFor, streakOf } from "../src/habits";
import { createTranslator } from "../src/i18n";
import { en } from "../src/i18n/en";
import { ptBR } from "../src/i18n/pt-BR";
import {
	JOURNAL_GROUPS,
	JOURNAL_KIND_SPECS,
	type JournalDraft,
	type JournalEditorTimers,
	activeContract,
	checkJournalEntry,
	contractCommitmentDefault,
	contractStatus,
	contractText,
	createJournalEditor,
	displayKind,
	groupTimelineByMonth,
	habitPatchFromRecovery,
	hasJournalContent,
	identityJournalStats,
	intentionSentence,
	isJournalKind,
	journalAnyOf,
	journalBlocks,
	journalEligibleHabits,
	journalEntryText,
	journalExampleKey,
	journalHintKey,
	journalKindHintKey,
	journalKindKey,
	journalKindSpec,
	journalKindUnavailable,
	journalLeadKey,
	journalLinkLabel,
	journalPreview,
	journalPromptKey,
	journalPrompts,
	journalTaskInput,
	journalTimeline,
	latestIntegrity,
	liveJournal,
	newJournalDraft,
	onScorecard,
	recoveryFor,
	recoveryPlanText,
	sanitizeAnswers,
	slipPrefill,
} from "../src/journal";
import {
	CUE_TYPES,
	type Habit,
	type HabitLog,
	type Identity,
	JOURNAL_ANSWER_MAX,
	JOURNAL_KINDS,
	JOURNAL_TEXT_MAX,
	type JournalEntry,
	type JournalKind,
	type ScorecardItem,
	habitSchema,
	identitySchema,
	journalEntrySchema,
	logId,
} from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, createAtomicStore } from "../src/store";
import { buildTrackerEntryIndex } from "../src/trackers/measure";
import type { TrackerEntry } from "../src/trackers/schema";

/**
 * Annex J §8 `journal.test.ts` (as amended by spec §3.4): kinds and blocks,
 * per-prompt sanitizing, drafts and prefills, completeness, sentences,
 * contracts, lookups, the timeline and search, the copy for every kind and
 * prompt, and the editor's autosave controller behind `useJournalEditor`.
 * The schema and store-action cases live in `store-journal.test.ts` (F).
 */

const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const TODAY = toDayKey(NOW); // 2026-10-20, a Tuesday
const t = createTranslator("en");
const pt = createTranslator("pt-BR");

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

function habit(partial: Partial<Habit> = {}): Habit {
	return habitSchema.parse({
		id: "h1",
		name: "Read 10 pages",
		createdAt: 0,
		updatedAt: 0,
		startDate: "2026-09-01",
		...partial,
	});
}

function identity(partial: Partial<Identity> = {}): Identity {
	return identitySchema.parse({
		id: "i1",
		statement: "I am a reader",
		createdAt: 0,
		updatedAt: 0,
		...partial,
	});
}

let seq = 0;
function entry(partial: Partial<JournalEntry> & { kind: string }): JournalEntry {
	seq++;
	return journalEntrySchema.parse({
		id: `j${seq}`,
		date: TODAY,
		createdAt: NOW + seq,
		updatedAt: NOW + seq,
		...partial,
	});
}

function log(habitId: string, date: DayKey, extra: Partial<HabitLog> = {}): HabitLog {
	return {
		id: logId(habitId, date),
		habitId,
		date,
		count: 1,
		skipped: false,
		note: null,
		createdAt: NOW,
		updatedAt: NOW,
		deletedAt: null,
		...extra,
	};
}

const draftOf = (kind: JournalKind, partial: Partial<JournalDraft> = {}): JournalDraft => ({
	...newJournalDraft(kind, { today: TODAY, weekStartsOn: 1, t }),
	...partial,
});

const buildHabit = habit({ id: "hb", kind: "build" });
const breakHabit = habit({ id: "hx", kind: "break", name: "Doomscrolling" });

describe("kinds and blocks (Annex J §1.1, §3.1)", () => {
	test("nine kinds with the Annex J groups, icons, accents and link rules", () => {
		expect(Object.keys(JOURNAL_KIND_SPECS)).toEqual([...JOURNAL_KINDS]);
		const table = JOURNAL_KINDS.map((k) => {
			const s = JOURNAL_KIND_SPECS[k];
			return [k, s.group, s.icon, s.color, s.identity, s.habit].join(" ");
		});
		expect(table).toEqual([
			"evidence quick vote ember required optional",
			"awareness quick eye stone optional hidden",
			"recovery plan refresh amber hidden any",
			"checkin plan gauge sky hidden build",
			"contract plan handshake violet hidden any",
			"belief reflect sparkles emerald optional hidden",
			"review reflect calendar-check indigo hidden hidden",
			"integrity reflect compass teal hidden hidden",
			"note free sticky-note stone optional optional",
		]);
		expect(new Set(JOURNAL_KINDS.map((k) => JOURNAL_KIND_SPECS[k].group))).toEqual(
			new Set(JOURNAL_GROUPS),
		);
	});

	test("unknown kinds read as notes; recovery blocks follow the habit's kind", () => {
		expect(isJournalKind("gratitude")).toBe(false);
		expect(journalKindSpec("gratitude")).toBe(JOURNAL_KIND_SPECS.note);
		expect(displayKind("gratitude")).toBe("note");
		expect(journalBlocks("gratitude")).toBe(journalBlocks("note"));
		const ids = (kind: string, h?: Habit) =>
			journalBlocks(kind, h).map((b) => (b.type === "prompt" ? b.prompt.id : `[${b.type}]`));
		expect(ids("recovery")).toEqual(ids("recovery", buildHabit));
		expect(ids("recovery", buildHabit)).toEqual([
			"obstacle",
			"when",
			"where",
			"after",
			"[intention]",
			"twoMinute",
		]);
		expect(ids("recovery", breakHabit)).toEqual([
			"trigger",
			"[cueType]",
			"hide",
			"friction",
			"[applyToHabit]",
		]);
		expect(ids("awareness")).toEqual(["behavior", "[rating]", "say", "[scorecard]"]);
		expect(ids("checkin")).toEqual(["[difficulty]", "[goldilocks]", "adjust"]);
		expect(ids("contract")).toEqual(["commitment", "consequence", "[contract]"]);
		expect(ids("belief")).toEqual(["oldStory", "newStory", "proof", "[makeTask]"]);
		expect(ids("review")).toEqual([
			"[snapshot]",
			"well",
			"notWell",
			"learned",
			"next",
			"[makeTask]",
		]);
		expect(ids("integrity")).toEqual(["values", "living", "standard"]);
		expect(journalAnyOf("recovery", buildHabit)).toEqual(["when", "where", "after", "twoMinute"]);
		expect(journalAnyOf("recovery", breakHabit)).toEqual(["hide", "friction"]);
		expect(journalAnyOf("review")).toEqual(["well", "notWell", "learned"]);
		expect(journalAnyOf("note")).toEqual([]);
	});

	test("prompt limits and inputs follow Annex J §1.1", () => {
		const spec = (kind: string, h?: Habit) =>
			journalPrompts(kind, h).map(
				(p) => `${p.id}:${p.input}/${p.maxLength}${p.required ? "/req" : ""}`,
			);
		expect(spec("evidence")).toEqual(["text:text/500/req"]);
		expect(spec("awareness")).toEqual(["behavior:line/160/req", "say:text/500"]);
		expect(spec("recovery", buildHabit)).toEqual([
			"obstacle:text/500/req",
			"when:time/5",
			"where:line/120",
			"after:line/160",
			"twoMinute:line/160",
		]);
		expect(spec("recovery", breakHabit)).toEqual([
			"trigger:text/500/req",
			"hide:line/280",
			"friction:line/160",
		]);
		expect(spec("checkin")).toEqual(["adjust:text/500"]);
		expect(spec("contract")).toEqual(["commitment:text/280/req", "consequence:text/280/req"]);
		expect(spec("belief")).toEqual([
			"oldStory:text/280/req",
			"newStory:line/120/req",
			"proof:line/280/req",
		]);
		expect(spec("review")).toEqual([
			"well:text/2000",
			"notWell:text/2000",
			"learned:text/2000",
			"next:line/280",
		]);
		expect(spec("integrity")).toEqual([
			"values:text/2000/req",
			"living:text/2000",
			"standard:text/2000",
		]);
		expect(spec("note")).toEqual(["text:text/8000/req"]);
	});
});

describe("copy for every kind and prompt (Annex J §8, spec §7 T3)", () => {
	const catalogs = { en, "pt-BR": ptBR } as Record<string, Record<string, string>>;
	const has = (key: string) => {
		for (const [locale, catalog] of Object.entries(catalogs)) {
			expect({ locale, key, present: typeof catalog[key] === "string" }).toEqual({
				locale,
				key,
				present: true,
			});
		}
	};

	test("labels, hints, leads, prompts, examples and helper lines exist in both catalogs", () => {
		for (const kind of JOURNAL_KINDS) {
			has(journalKindKey(kind));
			has(journalKindHintKey(kind));
			has(journalLeadKey(kind));
			const variants = kind === "recovery" ? [buildHabit, breakHabit] : [undefined];
			for (const h of variants) {
				for (const block of journalBlocks(kind, h)) {
					if (block.type === "prompt") {
						has(journalPromptKey(kind, block.prompt.id));
						if (block.prompt.hasExample) has(journalExampleKey(kind, block.prompt.id));
						if (block.prompt.hasHint) has(journalHintKey(kind, block.prompt.id));
					}
				}
			}
		}
		has(journalLeadKey("recovery", breakHabit));
		expect(journalLeadKey("recovery", breakHabit)).toBe("journal.lead.recoveryBreak");
		has(journalPromptKey("awareness", "rating"));
		has(journalPromptKey("checkin", "difficulty"));
		has(journalPromptKey("recovery", "cueType"));
		for (const group of JOURNAL_GROUPS) has(`journal.group.${group}`);
		for (const rating of ["positive", "neutral", "negative"]) has(`journal.rating.${rating}`);
		for (const d of ["too-easy", "just-right", "too-hard"]) has(`journal.difficulty.${d}`);
		for (const cue of CUE_TYPES) has(`cue.${cue}`);
		for (const s of ["draft", "active", "ended", "kept", "broken"]) has(`journal.contract.${s}`);
		for (const scope of ["week", "month", "year"]) has(`journal.review.scope.${scope}`);
		for (const c of ["weekly", "monthly", "off"]) has(`settings.reviewCadence.${c}`);
		for (const key of ["settings.reviewCadence", "shortcuts.newEntry", "shortcuts.goJournal"]) {
			has(key);
		}
		for (const key of ["notify.reviewTitle", "notify.reviewTitleMonth", "notify.reviewBody"]) {
			has(key);
		}
	});

	test("every prompt, example and hint key belongs to a prompt (no stray or misspelled keys)", () => {
		const expected = new Set<string>();
		for (const kind of JOURNAL_KINDS) {
			for (const h of kind === "recovery" ? [buildHabit, breakHabit] : [undefined]) {
				for (const p of journalPrompts(kind, h)) {
					expected.add(journalPromptKey(kind, p.id));
					if (p.hasExample) expected.add(journalExampleKey(kind, p.id));
					if (p.hasHint) expected.add(journalHintKey(kind, p.id));
				}
			}
		}
		for (const key of ["awareness.rating", "checkin.difficulty", "recovery.cueType"]) {
			expected.add(`journal.prompt.${key}`);
		}
		const actual = Object.keys(en).filter((k) => /^journal\.(prompt|example|hint)\./.test(k));
		expect(actual.sort()).toEqual([...expected].sort());
		// The journal's cue chips use the shared `cue.*` keys only.
		expect(Object.keys(en).filter((k) => k.startsWith("journal.cue."))).toEqual([]);
	});
});

describe("answers (spec §3.4)", () => {
	test("sanitizeAnswers clamps each answer to its prompt (unknown ids and kinds: 8,000)", () => {
		const long = "x".repeat(600);
		expect(sanitizeAnswers("evidence", { text: long }).text).toHaveLength(500);
		expect(sanitizeAnswers("awareness", { behavior: long }).behavior).toHaveLength(160);
		// Recovery takes both variants' prompts, and the cue chip's value.
		const recovery = sanitizeAnswers("recovery", {
			trigger: long,
			hide: long,
			friction: long,
			where: long,
			cueType: "location",
		});
		expect(Object.values(recovery).map((v) => v.length)).toEqual([500, 280, 160, 120, 8]);
		expect(sanitizeAnswers("evidence", { insight: "y".repeat(9_000) }).insight).toHaveLength(
			JOURNAL_ANSWER_MAX,
		);
		expect(sanitizeAnswers("gratitude", { text: "z".repeat(9_000) }).text).toHaveLength(
			JOURNAL_ANSWER_MAX,
		);
	});

	test("trims, CRLF → LF, drops empty and invalid ids and non-strings; the total stays within 20,000", () => {
		expect(
			sanitizeAnswers("review", {
				well: "  Read daily\r\nFinished a book\r ",
				notWell: "   ",
				"Bad-Id": "dropped",
				learned: 3,
			}),
		).toEqual({ well: "Read daily\nFinished a book" });
		// The clamp to 500 happens after trimming, so leading spaces don't eat the budget.
		expect(sanitizeAnswers("evidence", { text: `   ${"a".repeat(500)}` }).text).toHaveLength(500);
		const big = sanitizeAnswers("integrity", {
			values: "v".repeat(2_000),
			a: "x".repeat(8_000),
			b: "x".repeat(8_000),
			c: "x".repeat(8_000),
		});
		expect(Object.values(big).reduce((n, v) => n + v.length, 0)).toBe(JOURNAL_TEXT_MAX);
		expect(big.c).toHaveLength(2_000);
		expect(sanitizeAnswers("note", null as never)).toEqual({});
	});

	test("unsafe characters are dropped: controls (not tab or newline) and unpaired surrogates", () => {
		expect(stripUnsafeText("a\u0001b\tc\nd\u007fe\u0000")).toBe("ab\tc\nde");
		expect(stripUnsafeText("ok 🎉 \ud83d x \ude00 y")).toBe("ok 🎉  x  y");
		expect(stripUnsafeText("plain")).toBe("plain");
		expect(sanitizeJournalAnswers({ text: "\u0002\u0003Hi\ud800" })).toEqual({ text: "Hi" });
		expect(sanitizeAnswers("note", { text: "\u0007" })).toEqual({});
	});

	test("hasJournalContent: an answer, a rating, a difficulty or a signature", () => {
		const blank = { answers: {}, rating: null, difficulty: null, contract: null };
		expect(hasJournalContent(blank)).toBe(false);
		expect(hasJournalContent({ ...blank, answers: { text: "  " } })).toBe(false);
		expect(hasJournalContent({ ...blank, answers: { text: "Hi" } })).toBe(true);
		expect(hasJournalContent({ ...blank, rating: "neutral" })).toBe(true);
		expect(hasJournalContent({ ...blank, difficulty: "too-hard" })).toBe(true);
		const contract = { until: TODAY, partner: null, signedAt: null, outcome: null };
		expect(hasJournalContent({ ...blank, contract })).toBe(false);
		expect(hasJournalContent({ ...blank, contract: { ...contract, signedAt: NOW } })).toBe(true);
	});
});

describe("drafts and prefills (Annex J §1.4)", () => {
	const reader = identity();
	const meditate = habit({
		id: "hm",
		name: "Meditate",
		identityId: "mindful",
		cueTime: "07:00",
		cueLocation: "on the living room couch",
		stackAfter: null,
		twoMinute: "Take ten slow breaths",
	});

	test("evidence: the identity from the context, else the habit's; today unless a past day is given", () => {
		const ctx = { today: TODAY, weekStartsOn: 1 as const, t };
		expect(newJournalDraft("evidence", { ...ctx, identity: reader })).toEqual({
			kind: "evidence",
			date: TODAY,
			identityId: "i1",
			habitId: null,
			answers: {},
			rating: null,
			difficulty: null,
			range: null,
			contract: null,
			pinned: false,
		});
		const fromHabit = newJournalDraft("evidence", { ...ctx, habit: meditate, date: "2026-10-18" });
		expect(fromHabit).toMatchObject({ identityId: "mindful", habitId: "hm", date: "2026-10-18" });
		// A day after today is clamped to today.
		expect(newJournalDraft("note", { ...ctx, date: "2026-10-25" }).date).toBe(TODAY);
		// Kinds that hide the habit never link it.
		expect(
			newJournalDraft("awareness", { ...ctx, habit: meditate, identity: reader }),
		).toMatchObject({ habitId: null, identityId: "i1" });
	});

	test("recovery (build) prefills the habit's plan and is about the missed day", () => {
		const d = newJournalDraft("recovery", {
			today: TODAY,
			weekStartsOn: 1,
			t,
			habit: { ...meditate, stackAfter: "pour my coffee" },
			date: "2026-10-19",
		});
		expect(d).toMatchObject({
			kind: "recovery",
			date: "2026-10-19",
			habitId: "hm",
			identityId: "mindful",
			answers: {
				when: "07:00",
				where: "on the living room couch",
				after: "pour my coffee",
				twoMinute: "Take ten slow breaths",
			},
		});
	});

	test("recovery (break) prefills hide and friction; the trigger comes from the slip entry only", () => {
		const doom = habit({
			id: "hd",
			kind: "break",
			name: "Doomscrolling",
			environment: "Phone charges in the kitchen",
			twoMinute: "Log out after each use",
		});
		const entries: Record<string, TrackerEntry> = {
			a: {
				id: "a",
				habitId: "hd",
				date: TODAY,
				type: "slip",
				at: NOW - 60_000,
				data: { cue: "emotion", note: "Bored after lunch" },
				createdAt: NOW,
				updatedAt: NOW,
				deletedAt: null,
			},
			b: {
				id: "b",
				habitId: "hd",
				date: TODAY,
				type: "slip",
				at: NOW - 3_600_000,
				data: { cue: "time", note: "Earlier" },
				createdAt: NOW,
				updatedAt: NOW,
				deletedAt: null,
			},
		};
		const index = buildTrackerEntryIndex(entries);
		const prefill = slipPrefill(index, "hd", TODAY);
		expect(prefill).toEqual({ trigger: "Bored after lunch", cueType: "emotion" });
		expect(slipPrefill(index, "hd", "2026-10-19")).toEqual({});
		const d = newJournalDraft("recovery", {
			today: TODAY,
			weekStartsOn: 1,
			t,
			habit: doom,
			prefill,
		});
		expect(d.answers).toEqual({
			hide: "Phone charges in the kitchen",
			friction: "Log out after each use",
			trigger: "Bored after lunch",
			cueType: "emotion",
		});
		expect(
			newJournalDraft("recovery", { today: TODAY, weekStartsOn: 1, t, habit: doom }).answers,
		).not.toHaveProperty("trigger");
	});

	test("contract: the commitment sentence in en and pt, and a 30-day term (inclusive)", () => {
		const read = habit({ name: "Read 10 pages" });
		const ctx = { today: TODAY, weekStartsOn: 1 as const, habit: read };
		const d = newJournalDraft("contract", { ...ctx, t });
		expect(d.answers.commitment).toBe("I will read 10 pages, every day.");
		expect(d.contract).toEqual({
			until: addDays(TODAY, 29),
			partner: null,
			signedAt: null,
			outcome: null,
		});
		const ler = habit({ name: "Ler 10 páginas" });
		expect(newJournalDraft("contract", { ...ctx, habit: ler, t: pt }).answers.commitment).toBe(
			"Vou ler 10 páginas, todos os dias.",
		);
		const weekly = { type: "weekly", times: 3 } as const;
		expect(contractCommitmentDefault(habit({ name: "Work out", schedule: weekly }), t, 1)).toBe(
			"I will work out, 3 times a week.",
		);
		expect(contractCommitmentDefault(habit({ name: "Treinar", schedule: weekly }), pt, 1)).toBe(
			"Vou treinar, 3 vezes por semana.",
		);
		const days = { type: "weekdays" as const, days: [4, 1] };
		expect(contractCommitmentDefault(habit({ name: "Swim", schedule: days }), t, 1)).toBe(
			"I will swim on these days: Monday and Thursday.",
		);
		expect(contractCommitmentDefault(habit({ name: "Nadar", schedule: days }), pt, 1)).toBe(
			"Vou nadar nestes dias: segunda-feira e quinta-feira.",
		);
		// Every weekday reads as "every day".
		const all = { type: "weekdays" as const, days: [0, 1, 2, 3, 4, 5, 6] };
		expect(contractCommitmentDefault(habit({ name: "Walk", schedule: all }), t, 1)).toBe(
			"I will walk, every day.",
		);
		// The derived identity is shown, and the store copies it only while it's live.
		expect(newJournalDraft("contract", { ...ctx, t, habit: meditate }).identityId).toBe("mindful");
	});

	test("belief prefills the identity statement; review the default period; others nothing", () => {
		const ctx = { today: TODAY, weekStartsOn: 1 as const, t };
		expect(newJournalDraft("belief", { ...ctx, identity: reader }).answers).toEqual({
			newStory: "I am a reader",
		});
		// Tuesday: the previous week by default.
		expect(newJournalDraft("review", ctx).range).toEqual({ from: "2026-10-12", to: "2026-10-18" });
		expect(newJournalDraft("review", { ...ctx, scope: "month", date: "2026-10-01" })).toMatchObject(
			{
				date: TODAY,
				range: { from: "2026-10-01", to: "2026-10-31" },
			},
		);
		expect(newJournalDraft("review", { ...ctx, scope: "year" }).range).toEqual({
			from: "2026-01-01",
			to: "2026-12-31",
		});
		for (const kind of ["integrity", "note", "checkin", "awareness"] as const) {
			expect(newJournalDraft(kind, { ...ctx, habit: buildHabit }).answers).toEqual({});
		}
	});
});

describe("checkJournalEntry (Annex J §1.3)", () => {
	const habits = { hb: buildHabit, hx: breakHabit };
	const check = (d: JournalDraft) => checkJournalEntry(d, habits).missing;

	test("reports what each kind still needs", () => {
		expect(check(draftOf("evidence"))).toEqual(["identity", "text"]);
		expect(check(draftOf("evidence", { identityId: "i1", answers: { text: "Ran" } }))).toEqual([]);
		expect(check(draftOf("awareness"))).toEqual(["behavior", "rating"]);
		expect(
			check(draftOf("awareness", { answers: { behavior: "Phone" }, rating: "negative" })),
		).toEqual([]);
		expect(check(draftOf("recovery"))).toEqual(["habit", "obstacle", "anyOf"]);
		expect(check(draftOf("recovery", { habitId: "hb" }))).toEqual(["obstacle", "anyOf"]);
		expect(
			check(draftOf("recovery", { habitId: "hb", answers: { obstacle: "Late", when: "07:00" } })),
		).toEqual([]);
		expect(check(draftOf("recovery", { habitId: "hx", answers: { when: "07:00" } }))).toEqual([
			"trigger",
			"anyOf",
		]);
		expect(
			check(
				draftOf("recovery", { habitId: "hx", answers: { trigger: "Bed", friction: "Log out" } }),
			),
		).toEqual([]);
		expect(check(draftOf("checkin", { habitId: "hx" }))).toEqual(["habit", "difficulty"]);
		expect(check(draftOf("checkin", { habitId: "hb", difficulty: "too-easy" }))).toEqual([]);
		const contract = newJournalDraft("contract", {
			today: TODAY,
			weekStartsOn: 1,
			t,
			habit: buildHabit,
		});
		expect(check(contract)).toEqual(["consequence"]);
		expect(check({ ...contract, contract: null, answers: {} })).toEqual([
			"commitment",
			"consequence",
			"until",
		]);
		expect(check(draftOf("belief", { answers: { newStory: "I am an early riser" } }))).toEqual([
			"oldStory",
			"proof",
		]);
		expect(check(draftOf("review", { range: null }))).toEqual(["range", "anyOf"]);
		expect(check(draftOf("review", { answers: { learned: "Prep the night before" } }))).toEqual([]);
		expect(check(draftOf("integrity"))).toEqual(["values"]);
		expect(check(draftOf("note"))).toEqual(["text"]);
		expect(checkJournalEntry(draftOf("note", { kind: "future" }), habits)).toEqual({
			complete: true,
			missing: [],
		});
	});

	test("an entry whose habit was deleted later keeps its link and stays complete", () => {
		const gone = { ...buildHabit, deletedAt: NOW };
		const d = draftOf("checkin", { habitId: "hb", difficulty: "just-right" });
		expect(checkJournalEntry(d, { hb: gone }).complete).toBe(true);
		expect(checkJournalEntry(d, {}).complete).toBe(true);
	});

	test("kind availability and eligible habits", () => {
		const archived = habit({ id: "ha", archivedAt: NOW });
		const deleted = habit({ id: "hd", deletedAt: NOW });
		const none = { habits: [] as Habit[], identities: [] as Identity[] };
		expect(journalKindUnavailable("checkin", none)).toBe("journal.needsBuildHabit");
		expect(journalKindUnavailable("recovery", none)).toBe("journal.needsHabit");
		expect(journalKindUnavailable("evidence", none)).toBe("journal.needsIdentity");
		expect(journalKindUnavailable("note", none)).toBeNull();
		expect(
			journalKindUnavailable("checkin", { habits: [breakHabit, archived], identities: [] }),
		).toBe("journal.needsBuildHabit");
		expect(journalKindUnavailable("checkin", { habits: [buildHabit], identities: [] })).toBeNull();
		expect(
			journalKindUnavailable("evidence", { habits: [], identities: [identity({ deletedAt: 1 })] }),
		).toBe("journal.needsIdentity");
		const all = [buildHabit, breakHabit, archived, deleted];
		expect(journalEligibleHabits("checkin", all).map((h) => h.id)).toEqual(["hb"]);
		expect(journalEligibleHabits("recovery", all).map((h) => h.id)).toEqual(["hb", "hx"]);
		expect(journalEligibleHabits("belief", all)).toEqual([]);
	});
});

describe("sentences, plans and contracts (Annex J §1.4, §1.9)", () => {
	const meditate = habit({ name: "Meditate" });

	test("intentionSentence: the four shapes, in en and pt", () => {
		const cases: [Record<string, string>, string, string][] = [
			[
				{ after: "Pour my coffee", when: "07:00" },
				"After I pour my coffee, I will meditate.",
				"Depois de pour my coffee, vou meditate.",
			],
			[
				{ when: "07:00", where: "on the living room couch" },
				"I will meditate at 07:00 on the living room couch.",
				"Vou meditate às 07:00 on the living room couch.",
			],
			[{ when: "07:00" }, "I will meditate at 07:00.", "Vou meditate às 07:00."],
			[{ where: "in the park" }, "I will meditate in the park.", "Vou meditate in the park."],
		];
		for (const [answers, english, portuguese] of cases) {
			expect(intentionSentence(meditate, answers, t)).toBe(english);
			expect(intentionSentence(meditate, answers, pt)).toBe(portuguese);
		}
		expect(intentionSentence(meditate, { twoMinute: "Breathe" }, t)).toBeNull();
		const meditar = habit({ name: "Meditar" });
		expect(intentionSentence(meditar, { when: "07:00", where: "no sofá da sala" }, pt)).toBe(
			"Vou meditar às 07:00 no sofá da sala.",
		);
	});

	test("habitPatchFromRecovery (build): only changed, non-empty keys; a valid time only", () => {
		const h = habit({
			cueTime: "07:00",
			cueLocation: "Kitchen",
			stackAfter: null,
			twoMinute: null,
		});
		expect(
			habitPatchFromRecovery(h, {
				when: "07:00",
				where: "Kitchen",
				after: "  pour my   coffee ",
				twoMinute: "One page",
			}),
		).toEqual({ stackAfter: "pour my coffee", twoMinute: "One page" });
		expect(habitPatchFromRecovery(h, { when: "7am", where: "Bedroom" })).toEqual({
			cueLocation: "Bedroom",
		});
		expect(habitPatchFromRecovery(h, { when: "06:30" })).toEqual({ cueTime: "06:30" });
		expect(
			habitPatchFromRecovery(h, { when: "07:00", where: "Kitchen", obstacle: "x" }),
		).toBeNull();
		expect(habitPatchFromRecovery(h, { where: "w".repeat(200) })?.cueLocation).toHaveLength(120);
	});

	test("habitPatchFromRecovery (break): hide and friction; the trigger only without a cue or stack", () => {
		const free = habit({ kind: "break", cueLocation: null, stackAfter: null, environment: "Old" });
		expect(
			habitPatchFromRecovery(free, {
				trigger: "Phone on the\nnightstand",
				hide: "Charge it in the kitchen",
				friction: "Log out",
				cueType: "location",
			}),
		).toEqual({
			environment: "Charge it in the kitchen",
			twoMinute: "Log out",
			cueLocation: "Phone on the nightstand",
		});
		const cued = { ...free, stackAfter: "Dinner" };
		expect(habitPatchFromRecovery(cued, { trigger: "Phone", hide: "Old" })).toBeNull();
		expect(habitPatchFromRecovery(free, { trigger: "t".repeat(500) })?.cueLocation).toHaveLength(
			120,
		);
	});

	test("contractStatus: draft, active, ended, kept, broken", () => {
		const c = (contract: JournalEntry["contract"]) => ({ contract });
		const terms = { until: "2026-11-18", partner: "Ana", signedAt: null, outcome: null };
		expect(contractStatus(c(null), TODAY)).toBe("draft");
		expect(contractStatus(c(terms), TODAY)).toBe("draft");
		const signed = { ...terms, signedAt: NOW };
		expect(contractStatus(c(signed), "2026-11-18")).toBe("active");
		expect(contractStatus(c(signed), "2026-11-19")).toBe("ended");
		expect(contractStatus(c({ ...signed, outcome: "kept" }), "2026-11-19")).toBe("kept");
		expect(contractStatus(c({ ...signed, outcome: "broken" }), TODAY)).toBe("broken");
	});

	test("contractText: commitment, consequence, end date, signature and partner (en, pt)", () => {
		const e = entry({
			kind: "contract",
			habitId: "h1",
			answers: { commitment: "I will work out, 3 times a week.", consequence: "pay Ana $20" },
			contract: { until: "2026-11-18", partner: "Ana", signedAt: NOW, outcome: null },
		});
		expect(contractText(e, habit(), "Leo", t)).toBe(
			[
				"Habit contract",
				"",
				"I will work out, 3 times a week.",
				"If I break it: pay Ana $20",
				"Valid until Wednesday, November 18.",
				"",
				"Signed: Leo, Oct 20",
				"Accountability partner: Ana",
			].join("\n"),
		);
		const terms = e.contract as NonNullable<JournalEntry["contract"]>;
		const draft = { ...e, contract: { ...terms, signedAt: null, partner: null } };
		expect(contractText(draft, habit(), "", pt)).toBe(
			[
				"Contrato de hábito",
				"",
				"I will work out, 3 times a week.",
				"Se eu quebrar: pay Ana $20",
				"Válido até quarta-feira, 18 de novembro.",
				"",
				"Ainda não assinado.",
			].join("\n"),
		);
		expect(contractText({ ...e, answers: {} }, habit({ name: "Run" }), "", t)).toContain(
			"Habit contract\n\nRun\n",
		);
		expect(contractText(e, undefined, " ", t)).toContain("Signed on Oct 20");
	});

	test("journalTaskInput: today for a belief, after the period for a review, Someday for a year", () => {
		const belief = draftOf("belief", { identityId: "i1", answers: { proof: " Cook twice " } });
		expect(journalTaskInput(belief, "proof", TODAY)).toEqual({
			title: "Cook twice",
			date: TODAY,
			identityId: "i1",
		});
		const week = draftOf("review", { answers: { next: "Pack the bag" } });
		expect(journalTaskInput(week, "next", TODAY)?.date).toBe(TODAY); // the week ended Sunday
		const current = { ...week, range: { from: "2026-10-19", to: "2026-10-25" } };
		expect(journalTaskInput(current, "next", TODAY)?.date).toBe("2026-10-26");
		const year = { ...week, range: { from: "2026-01-01", to: "2026-12-31" } };
		expect(journalTaskInput(year, "next", TODAY)?.date).toBeNull();
		expect(journalTaskInput(week, "proof", TODAY)).toBeNull();
	});

	test("onScorecard compares live labels folded", () => {
		const item = (label: string, deletedAt: number | null = null) =>
			({ id: label, label, deletedAt }) as ScorecardItem;
		const items = [item("Olhar o celular na cama"), item("Snooze", NOW)];
		expect(onScorecard(items, "  olhar O CELULAR na cama ")).toBe(true);
		expect(onScorecard(items, "Olhar o celular na cáma")).toBe(true);
		expect(onScorecard(items, "Snooze")).toBe(false);
		expect(onScorecard(items, "   ")).toBe(false);
	});
});

describe("lookups and stats (Annex J §3.1)", () => {
	test("liveJournal, activeContract, recoveryFor, latestIntegrity, recoveryPlanText", () => {
		const older = entry({ kind: "note", date: "2026-10-18", answers: { text: "a" } });
		const newer = entry({ kind: "note", date: "2026-10-19", answers: { text: "b" } });
		const sameDayLater = entry({ kind: "note", date: "2026-10-19", answers: { text: "c" } });
		const gone = entry({ kind: "note", deletedAt: NOW, answers: { text: "d" } });
		const records = Object.fromEntries([older, newer, sameDayLater, gone].map((e) => [e.id, e]));
		expect(liveJournal(records).map((e) => e.id)).toEqual([sameDayLater.id, newer.id, older.id]);

		const terms = { until: "2026-11-18", partner: null, outcome: null };
		const first = entry({ kind: "contract", habitId: "h1", contract: { ...terms, signedAt: 10 } });
		const second = entry({ kind: "contract", habitId: "h1", contract: { ...terms, signedAt: 20 } });
		const ended = entry({
			kind: "contract",
			habitId: "h1",
			contract: { ...terms, until: "2026-10-19", signedAt: 30 },
		});
		const unsigned = entry({
			kind: "contract",
			habitId: "h1",
			contract: { ...terms, signedAt: null },
		});
		const journal = [first, second, ended, unsigned];
		expect(activeContract(journal, "h1", TODAY)?.id).toBe(second.id);
		expect(activeContract(journal, "h2", TODAY)).toBeUndefined();

		const plan = entry({
			kind: "recovery",
			habitId: "h1",
			date: "2026-10-19",
			answers: { when: "07:00" },
		});
		const later = entry({
			kind: "recovery",
			habitId: "h1",
			date: "2026-10-19",
			answers: { where: "Park" },
		});
		expect(recoveryFor([plan, later], "h1", "2026-10-19")?.id).toBe(later.id);
		expect(recoveryFor([plan, later], "h1", TODAY)).toBeUndefined();
		expect(
			recoveryFor({ [plan.id]: { ...plan, deletedAt: 1 } }, "h1", "2026-10-19"),
		).toBeUndefined();
		const meditate = habit({ name: "Meditate" });
		expect(recoveryPlanText(plan, meditate, t)).toBe("I will meditate at 07:00.");
		const twoMin = entry({ kind: "recovery", habitId: "h1", answers: { twoMinute: "Breathe" } });
		expect(recoveryPlanText(twoMin, meditate, t)).toBe("Breathe");
		expect(
			recoveryPlanText(entry({ kind: "recovery", answers: { obstacle: "x" } }), meditate, t),
		).toBeNull();
		const slip = entry({ kind: "recovery", answers: { trigger: "x", friction: "Log out" } });
		expect(recoveryPlanText(slip, breakHabit, t)).toBe("Log out");

		const june = entry({ kind: "integrity", date: "2026-06-20", answers: { values: "Health" } });
		const july = entry({ kind: "integrity", date: "2026-07-01", answers: { living: "Mostly" } });
		expect(latestIntegrity([june, july])?.id).toBe(june.id);
		expect(latestIntegrity([])).toBeUndefined();
	});

	test("identityJournalStats counts evidence and entries, and keeps the newest", () => {
		const a = entry({
			kind: "evidence",
			identityId: "i1",
			date: "2026-10-01",
			answers: { text: "a" },
		});
		const b = entry({
			kind: "evidence",
			identityId: "i1",
			date: "2026-10-10",
			answers: { text: "b" },
		});
		const c = entry({ kind: "belief", identityId: "i1", date: "2026-10-05" });
		const d = entry({ kind: "evidence", identityId: "i2" });
		const e = entry({ kind: "evidence", identityId: "i1", deletedAt: NOW });
		const f = entry({ kind: "note" });
		const stats = identityJournalStats([a, b, c, d, e, f]);
		expect(stats.get("i1")).toEqual({ evidence: 2, entries: 3, latest: b });
		expect(stats.get("i2")).toEqual({ evidence: 1, entries: 1, latest: d });
		expect([...stats.keys()].sort()).toEqual(["i1", "i2"]);
	});

	test("journalLinkLabel: live, deleted (tombstone) and missing links", () => {
		const identities = {
			i1: identity(),
			i2: identity({ id: "i2", statement: "I am an athlete", deletedAt: NOW }),
		};
		expect(journalLinkLabel("identity", "i1", identities, t)).toEqual({
			text: "I am a reader",
			deleted: false,
		});
		expect(journalLinkLabel("identity", "i2", identities, t)).toEqual({
			text: "I am an athlete (deleted)",
			deleted: true,
		});
		expect(journalLinkLabel("identity", "i2", identities, pt)?.text).toBe(
			"I am an athlete (excluída)",
		);
		expect(journalLinkLabel("habit", "gone", { hb: buildHabit }, t)).toEqual({
			text: "Deleted habit",
			deleted: true,
		});
		expect(journalLinkLabel("habit", null, { hb: buildHabit }, t)).toBeNull();
	});
});

describe("timeline, search and text (Annex J §1.10)", () => {
	const identities = {
		reader: identity({ id: "reader", statement: "I am a reader" }),
		athlete: identity({ id: "athlete", statement: "I am an athlete", deletedAt: NOW }),
	};
	const habits = {
		read: habit({ id: "read", name: "Read", identityId: "reader" }),
		run: habit({ id: "run", name: "Run", identityId: "athlete" }),
		old: habit({ id: "old", name: "Old habit", identityId: "reader", archivedAt: NOW }),
		gone: habit({ id: "gone", name: "Gone", deletedAt: NOW }),
	};
	const lesson = entry({
		kind: "evidence",
		identityId: "reader",
		habitId: "read",
		date: "2026-10-19",
		answers: { text: "Aprendi uma lição importante" },
	});
	const plan = entry({
		kind: "recovery",
		habitId: "run",
		identityId: "athlete",
		date: "2026-10-19",
		answers: { obstacle: "Rain", where: "Gym" },
	});
	const loose = entry({ kind: "note", date: "2026-09-30", answers: { text: "Loose thought" } });
	const future = entry({ kind: "gratitude", date: "2026-10-01", answers: { thanks: "Sun" } });
	const contract = entry({
		kind: "contract",
		habitId: "read",
		identityId: "missing",
		date: "2026-10-02",
		answers: { commitment: "Read daily" },
		contract: { until: "2026-11-01", partner: "Ana Luísa", signedAt: null, outcome: null },
	});
	const deleted = entry({ kind: "note", deletedAt: NOW, answers: { text: "lição" } });
	const logs = {
		a: log("read", "2026-10-19", { note: "Great chapter", createdAt: 5 }),
		b: log("run", "2026-10-18", { note: "Sore legs" }),
		c: log("old", "2026-09-30", { note: "Archived note" }),
		d: log("gone", "2026-10-17", { note: "Deleted habit's note" }),
		e: log("read", "2026-10-16", { note: "   " }),
		f: log("read", "2026-10-15", { note: "Tombstone", deletedAt: NOW }),
	};
	const data = {
		journal: [lesson, plan, loose, future, contract, deleted],
		logs,
		habits,
		identities,
	};
	const keys = (filter: Parameters<typeof journalTimeline>[1]) =>
		journalTimeline(data, filter).map((item) => item.key);

	test("merges day notes; newest day first, entries before notes, then newest written", () => {
		expect(keys({})).toEqual([
			`entry:${plan.id}`,
			`entry:${lesson.id}`,
			`note:${logId("read", "2026-10-19")}`,
			`note:${logId("run", "2026-10-18")}`,
			`entry:${contract.id}`,
			`entry:${future.id}`,
			`entry:${loose.id}`,
			`note:${logId("old", "2026-09-30")}`,
		]);
	});

	test("filters by identity (day notes via the habit; none = no, missing or deleted identity)", () => {
		expect(keys({ identityId: "reader" })).toEqual([
			`entry:${lesson.id}`,
			`note:${logId("read", "2026-10-19")}`,
			`note:${logId("old", "2026-09-30")}`,
		]);
		expect(keys({ identityId: "none" })).toEqual([
			`entry:${plan.id}`,
			`note:${logId("run", "2026-10-18")}`,
			`entry:${contract.id}`,
			`entry:${future.id}`,
			`entry:${loose.id}`,
		]);
	});

	test("filters by habit, kinds (notes include newer kinds), day notes and dates", () => {
		expect(keys({ habitId: "read" })).toEqual([
			`entry:${lesson.id}`,
			`note:${logId("read", "2026-10-19")}`,
			`entry:${contract.id}`,
		]);
		expect(keys({ kinds: ["note"] })).toEqual([`entry:${future.id}`, `entry:${loose.id}`]);
		expect(keys({ kinds: ["dayNote"] })).toHaveLength(3);
		expect(keys({ kinds: ["evidence", "dayNote"], from: "2026-10-01", to: "2026-10-18" })).toEqual([
			`note:${logId("run", "2026-10-18")}`,
		]);
		expect(keys({ kinds: [] })).toHaveLength(8);
	});

	test("search: every word must match, accents and case ignored; partner, habit and identity count", () => {
		expect(keys({ query: "licao" })).toEqual([`entry:${lesson.id}`]);
		expect(keys({ query: "LIÇÃO importante" })).toEqual([`entry:${lesson.id}`]);
		expect(keys({ query: "lição missing-word" })).toEqual([]);
		expect(keys({ query: "luisa" })).toEqual([`entry:${contract.id}`]);
		expect(keys({ query: "athlete" })).toEqual([`entry:${plan.id}`]);
		expect(keys({ query: "chapter read" })).toEqual([`note:${logId("read", "2026-10-19")}`]);
		expect(keys({ query: "  " })).toHaveLength(8);
	});

	test("groupTimelineByMonth keeps timeline order", () => {
		const groups = groupTimelineByMonth(journalTimeline(data, {}));
		expect(groups.map((g) => [g.month, g.items.length])).toEqual([
			["2026-10", 6],
			["2026-09", 2],
		]);
	});

	test("journalEntryText and journalPreview follow block order; unknown ids last; cue values hidden", () => {
		const review = entry({
			kind: "review",
			answers: { next: "Pack the bag", learned: "Prep helps", well: "Read   daily\nall week" },
		});
		expect(journalEntryText(review)).toBe("Read   daily\nall week\n\nPrep helps\n\nPack the bag");
		expect(journalPreview(review)).toBe("Read daily all week");
		const slip = entry({
			kind: "recovery",
			answers: { cueType: "location", trigger: "Couch", extra: "From a newer app" },
		});
		expect(journalEntryText(slip)).toBe("Couch\n\nFrom a newer app");
		expect(journalEntryText(future)).toBe("Sun");
		const long = entry({ kind: "note", answers: { text: "word ".repeat(100) } });
		const preview = journalPreview(long, 20);
		expect(preview).toBe("word word word word…");
		expect(preview.length).toBeLessThanOrEqual(20);
		expect(journalPreview(entry({ kind: "note" }))).toBe("");
	});
});

describe("demo journal (Annex J §2.6)", () => {
	test("every demo entry is complete, and the meditate plan is the banner's sentence (en, pt)", () => {
		for (const [locale, tr, sentence] of [
			["en", t, "I will meditate at 07:00 on the living room couch."],
			["pt-BR", pt, "Vou meditar às 07:00 no sofá da sala."],
		] as const) {
			const data = buildDemoData({ today: TODAY, now: NOW, locale });
			const journal = liveJournal(data.journal);
			expect(journal).toHaveLength(9);
			for (const e of journal) {
				expect({ kind: e.kind, missing: checkJournalEntry(e, data.habits).missing }).toEqual({
					kind: e.kind,
					missing: [],
				});
			}
			const meditate = data.habits["demo-habit-meditate"] as Habit;
			const streak = streakOf(meditate, logsFor(buildLogIndex(data.logs), meditate.id), TODAY);
			const plan = recoveryFor(journal, meditate.id, streak.lastMiss as DayKey);
			expect(plan && recoveryPlanText(plan, meditate, tr)).toBe(sentence);
			const workout = data.habits["demo-habit-workout"] as Habit;
			expect(activeContract(journal, workout.id, TODAY)?.answers.commitment).toBe(
				contractCommitmentDefault(workout, tr, 1),
			);
			expect(latestIntegrity(journal)?.pinned).toBe(true);
		}
	});
});

// ── The editor's autosave controller (Annex J §1.3) ──

function fakeTimers() {
	let next = 1;
	const pending = new Map<number, () => void>();
	const timers: JournalEditorTimers & { run(): void; readonly size: number } = {
		set(fn) {
			const id = next++;
			pending.set(id, fn);
			return id;
		},
		clear(handle) {
			pending.delete(handle as number);
		},
		run() {
			const fns = [...pending.values()];
			pending.clear();
			for (const fn of fns) fn();
		},
		get size() {
			return pending.size;
		},
	};
	return timers;
}

function makeStore(clock = { now: NOW }): AtomicStore {
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: () => clock.now,
		debounceMs: 0,
		deviceLocales: () => ["en"],
	});
	store.getState().actions.setTracking(true);
	return store;
}

const journalOf = (store: AtomicStore) => store.getState().data.journal;

describe("editor autosave (Annex J §1.3, useJournalEditor)", () => {
	test("opening writes nothing; the first change creates the entry with every draft value", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		const mindful = actions.createIdentity({ statement: "I am mindful" });
		const meditate = actions.createHabit({
			name: "Meditate",
			identityId: mindful.id,
			cueTime: "07:00",
			cueLocation: "on the couch",
		});
		const timers = fakeTimers();
		const initial = newJournalDraft("recovery", {
			today: TODAY,
			weekStartsOn: 1,
			t,
			habit: meditate,
			date: "2026-10-19",
		});
		const editor = createJournalEditor(store, { initial, timers });
		expect(editor.getSnapshot()).toMatchObject({ entryId: null, status: "idle" });
		expect(journalOf(store)).toEqual({});

		editor.setAnswer("obstacle", "Overslept");
		const { entryId, status } = editor.getSnapshot();
		expect(status).toBe("saved");
		expect(timers.size).toBe(0);
		const created = journalOf(store)[entryId as string] as JournalEntry;
		expect(created).toMatchObject({
			kind: "recovery",
			date: "2026-10-19",
			habitId: meditate.id,
			identityId: mindful.id,
			answers: { obstacle: "Overslept", when: "07:00", where: "on the couch" },
			createdAt: NOW,
		});
		expect(store.getState().sync.pending[`journal/${entryId}`]).toBe(true);
		expect(editor.finish()).toEqual(created);
		expect(journalOf(store)[entryId as string]?.deletedAt).toBeNull();
	});

	test("later changes are debounced, stamped strictly newer and clamped per prompt; flush writes now", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const timers = fakeTimers();
		const initial = newJournalDraft("evidence", {
			today: TODAY,
			weekStartsOn: 1,
			t,
			identity: identity({ id: "ix" }),
		});
		const editor = createJournalEditor(store, { initial, timers, debounceMs: 600 });
		editor.setAnswer("text", "R");
		const id = editor.getSnapshot().entryId as string;
		editor.setAnswer("text", "Re");
		editor.setAnswer("text", `Read ${"x".repeat(600)}`);
		expect(editor.getSnapshot().status).toBe("saving");
		expect(timers.size).toBe(1);
		expect(journalOf(store)[id]?.answers.text).toBe("R");
		timers.run();
		const written = journalOf(store)[id] as JournalEntry;
		expect(editor.getSnapshot().status).toBe("saved");
		expect(written.answers.text).toHaveLength(500);
		expect(written.updatedAt).toBe(NOW + 1);
		// The draft keeps what the user typed; only the stored copy is clamped.
		expect(editor.getSnapshot().draft.answers.text).toHaveLength(605);

		editor.update({ pinned: true });
		editor.flush();
		expect(timers.size).toBe(0);
		expect(journalOf(store)[id]?.pinned).toBe(true);
		// Nothing changed: no write.
		const before = journalOf(store)[id];
		editor.update({ pinned: true });
		editor.setAnswer("text", editor.getSnapshot().draft.answers.text as string);
		editor.flush();
		expect(journalOf(store)[id]).toBe(before);
	});

	test("finish deletes an emptied entry, and one that holds only the prefills", () => {
		const store = makeStore();
		const timers = fakeTimers();
		const evidence = createJournalEditor(store, {
			initial: draftOf("evidence", { identityId: "i1" }),
			timers,
		});
		evidence.setAnswer("text", "a");
		const id = evidence.getSnapshot().entryId as string;
		evidence.setAnswer("text", "");
		expect(evidence.finish()).toBeNull();
		expect(journalOf(store)[id]?.deletedAt).not.toBeNull();
		expect(evidence.getSnapshot()).toMatchObject({ entryId: null, status: "idle" });

		const plan = newJournalDraft("recovery", {
			today: TODAY,
			weekStartsOn: 1,
			t,
			habit: habit({ id: "hq", cueTime: "07:00" }),
		});
		const recovery = createJournalEditor(store, { initial: plan, timers });
		recovery.setAnswer("obstacle", "x");
		const planId = recovery.getSnapshot().entryId as string;
		recovery.setAnswer("obstacle", "");
		expect(recovery.finish()).toBeNull();
		expect(journalOf(store)[planId]?.deletedAt).not.toBeNull();

		// A no-op change on a prefilled draft creates nothing.
		const untouched = createJournalEditor(store, { initial: plan, timers });
		untouched.setAnswer("when", "07:00");
		untouched.update({ date: plan.date });
		expect(untouched.getSnapshot().entryId).toBeNull();
		expect(untouched.finish()).toBeNull();
	});

	test("the editor stays usable after finish (StrictMode's extra unmount)", () => {
		const store = makeStore();
		const timers = fakeTimers();
		const editor = createJournalEditor(store, { initial: draftOf("note"), timers });
		expect(editor.finish()).toBeNull();
		editor.setAnswer("text", "Still here");
		const id = editor.getSnapshot().entryId as string;
		expect(editor.finish()?.answers.text).toBe("Still here");
		editor.setAnswer("text", "Still here, edited");
		expect(editor.finish()?.answers.text).toBe("Still here, edited");
		expect(journalOf(store)[id]?.deletedAt).toBeNull();
	});

	test("kind is fixed; a recovery's habit is fixed once created; untouched long answers are kept", () => {
		const store = makeStore();
		const timers = fakeTimers();
		const { actions } = store.getState();
		const a = actions.createHabit({ name: "A" });
		const b = actions.createHabit({ name: "B" });
		const initial = newJournalDraft("recovery", { today: TODAY, weekStartsOn: 1, t, habit: a });
		const editor = createJournalEditor(store, { initial, timers });
		editor.update({ habitId: b.id }); // before creation: still a draft, may change
		expect(editor.getSnapshot().draft.habitId).toBe(b.id);
		editor.setAnswer("obstacle", "Late");
		editor.update({ habitId: a.id, kind: "note" });
		expect(editor.getSnapshot().draft).toMatchObject({ habitId: b.id, kind: "recovery" });
		editor.flush();
		const id = editor.getSnapshot().entryId as string;
		expect(journalOf(store)[id]).toMatchObject({ kind: "recovery", habitId: b.id });

		// A newer build wrote a longer answer than this build allows: editing another field keeps it.
		const long = "o".repeat(700);
		store.setState((s) => ({
			data: {
				...s.data,
				journal: {
					...s.data.journal,
					[id]: { ...(s.data.journal[id] as JournalEntry), answers: { obstacle: long } },
				},
			},
		}));
		const reopened = createJournalEditor(store, { entryId: id, timers });
		expect(reopened.getSnapshot()).toMatchObject({ entryId: id, status: "saved" });
		reopened.setAnswer("where", "Gym");
		reopened.flush();
		expect(journalOf(store)[id]?.answers).toEqual({ obstacle: long, where: "Gym" });
		reopened.setAnswer("obstacle", `${long}!`);
		reopened.flush();
		expect(journalOf(store)[id]?.answers.obstacle).toHaveLength(500);
	});

	test("derived identities go through the store: a deleted identity isn't copied", () => {
		const store = makeStore();
		const timers = fakeTimers();
		const { actions } = store.getState();
		const gone = actions.createIdentity({ statement: "I am gone" });
		const h = actions.createHabit({ name: "Run", identityId: gone.id });
		store.setState((s) => ({
			data: {
				...s.data,
				identities: { ...s.data.identities, [gone.id]: { ...gone, deletedAt: NOW } },
			},
		}));
		const initial = newJournalDraft("checkin", { today: TODAY, weekStartsOn: 1, t, habit: h });
		expect(initial.identityId).toBe(gone.id);
		const editor = createJournalEditor(store, { initial, timers });
		editor.update({ difficulty: "too-hard" });
		const id = editor.getSnapshot().entryId as string;
		expect(journalOf(store)[id]?.identityId).toBeNull();
		expect(editor.getSnapshot().draft.identityId).toBeNull();
	});

	test("sign flushes pending terms first; the draft follows the signature and outcome", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const timers = fakeTimers();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Work out", schedule: { type: "weekly", times: 3 } });
		const initial = newJournalDraft("contract", { today: TODAY, weekStartsOn: 1, t, habit: h });
		const editor = createJournalEditor(store, { initial, timers });
		const seen: number[] = [];
		const unsubscribe = editor.subscribe(() => seen.push(1));
		editor.update({
			contract: { ...(initial.contract as JournalEntry["contract"] & object), partner: "Ana" },
		});
		const id = editor.getSnapshot().entryId as string;
		expect(editor.sign()).toBe(false); // no consequence yet
		editor.setAnswer("consequence", "Pay Ana $20");
		expect(timers.size).toBe(1);
		clock.now += 1_000;
		expect(editor.sign()).toBe(true);
		expect(timers.size).toBe(0);
		expect(editor.getSnapshot().draft.contract?.signedAt).toBe(clock.now);
		actions.setContractOutcome(id, "kept");
		expect(editor.getSnapshot().draft.contract?.outcome).toBe("kept");
		actions.updateJournalEntry(id, { pinned: true });
		expect(editor.getSnapshot().draft.pinned).toBe(true);
		expect(seen.length).toBeGreaterThan(3);
		unsubscribe();
		expect(editor.finish()?.contract).toMatchObject({ partner: "Ana", outcome: "kept" });
	});

	test("an invalid draft is not saved (the store throws) and the editor keeps going", () => {
		const store = makeStore();
		const editor = createJournalEditor(store, {
			initial: draftOf("note", { date: "not-a-day" }),
			timers: fakeTimers(),
		});
		editor.setAnswer("text", "Hello");
		expect(editor.getSnapshot()).toMatchObject({ entryId: null, status: "idle" });
		expect(journalOf(store)).toEqual({});
		editor.update({ date: TODAY });
		expect(editor.getSnapshot().entryId).not.toBeNull();
	});
});
