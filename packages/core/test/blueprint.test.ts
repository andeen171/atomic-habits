import { describe, expect, test } from "bun:test";
import {
	BLUEPRINT_FIELDS,
	blueprintCompleteness,
	blueprintPatch,
	blueprintSlotSpecs,
	blueprintSlots,
	lawHeading,
	progressLabel,
	slotTitle,
	weakestLaw,
} from "../src/blueprint";
import { createTranslator, en, ptBR } from "../src/i18n";
import { type Habit, habitSchema } from "../src/model";

/** Annex H §8 `blueprint.test.ts`, with the spec §5.3 concepts (D14). */
const enT = createTranslator("en");
const ptT = createTranslator("pt-BR");

/** Fixture input: a tracker may be an input config (parsed with defaults). */
type HabitFixture = Omit<Partial<Habit>, "tracker"> & { tracker?: Record<string, unknown> | null };

const habit = (partial: HabitFixture = {}): Habit =>
	habitSchema.parse({
		id: "h1",
		name: "Read",
		createdAt: 0,
		updatedAt: 0,
		startDate: "2026-01-01",
		...partial,
	});

describe("blueprint slots", () => {
	test("build habits have 8 slots in law order; break habits 5 with their own concepts", () => {
		const build = blueprintSlots(habit());
		expect(build.map((s) => s.field)).toEqual([...BLUEPRINT_FIELDS]);
		expect(build.map((s) => s.law)).toEqual([1, 1, 1, 1, 2, 2, 3, 4]);
		const brk = blueprintSlots(habit({ kind: "break" }));
		expect(brk.map((s) => [s.field, s.law])).toEqual([
			["cueLocation", 1],
			["environment", 1],
			["bundle", 2],
			["twoMinute", 3],
			["reward", 4],
		]);
		expect(brk.every((s) => s.concept.startsWith("blueprint.concept.break."))).toBe(true);
		// Break concepts never repeat the column header ("Make it invisible", …).
		const headers = [1, 2, 3, 4].map((law) => enT.t(`law.${law}.inverse` as never));
		for (const slot of brk) expect(headers).not.toContain(enT.t(slot.concept));
		expect(ptT.t("blueprint.concept.break.cueLocation")).toBe("Aponte e nomeie");
		expect(ptT.t("blueprint.concept.cueTime")).toBe("Intenção de implementação · quando");
	});

	test("every concept, hint and placeholder key exists in both catalogs", () => {
		for (const kind of ["build", "break"] as const) {
			for (const spec of blueprintSlotSpecs(kind)) {
				for (const key of [spec.concept, spec.hint, spec.placeholder]) {
					expect({ key, en: key in en, pt: key in ptBR }).toEqual({ key, en: true, pt: true });
				}
			}
		}
	});

	test("a break trigger reads cueLocation, else stackAfter", () => {
		expect(blueprintSlots(habit({ kind: "break", stackAfter: "wake up" }))[0]?.value).toBe(
			"wake up",
		);
		expect(
			blueprintSlots(habit({ kind: "break", cueLocation: "Bed", stackAfter: "x" }))[0]?.value,
		).toBe("Bed");
	});

	test("slotTitle formats values in en and pt, without a doubled “I get to”; empty slots show the concept", () => {
		const h = habit({ cueTime: "21:30", stackAfter: "Brush my teeth", why: "I get to learn" });
		const slot = (field: string) =>
			blueprintSlots(h).find((s) => s.field === field) as ReturnType<typeof blueprintSlots>[number];
		expect(slotTitle(slot("cueTime"), enT)).toBe("At 21:30");
		expect(slotTitle(slot("cueTime"), ptT)).toBe("Às 21:30");
		expect(slotTitle(slot("stackAfter"), enT)).toBe("After I brush my teeth");
		expect(slotTitle(slot("stackAfter"), ptT)).toBe("Depois de brush my teeth");
		expect(slotTitle(slot("why"), enT)).toBe("I get to learn");
		const ptWhy = blueprintSlots(habit({ why: "Eu tenho a oportunidade de ler" })).find(
			(s) => s.field === "why",
		);
		expect(ptWhy && slotTitle(ptWhy, ptT)).toBe("Eu tenho a oportunidade de ler");
		expect(slotTitle(slot("reward"), enT)).toBe("Immediate reward");
	});

	test("law headings use inverse names for break habits", () => {
		expect(lawHeading(1, "build", enT)).toEqual({ name: "Make it obvious", stage: "Cue" });
		expect(lawHeading(1, "break", ptT)).toEqual({
			name: ptT.t("law.1.inverse"),
			stage: ptT.t("law.1.stage"),
		});
	});

	test("completeness and the weakest law (ties go to the lowest law)", () => {
		expect(blueprintCompleteness(habit())).toEqual({ filled: 0, total: 8 });
		expect(weakestLaw(habit())).toBe(1);
		const h = habit({
			cueTime: "07:00",
			cueLocation: "desk",
			bundle: "tea",
			twoMinute: "one page",
		});
		expect(blueprintCompleteness(h)).toEqual({ filled: 4, total: 8 });
		expect(weakestLaw(h)).toBe(4); // law 4: 0/1; law 1: 2/4
		expect(weakestLaw(habit({ reward: "tea", twoMinute: "x", bundle: "y", why: "z" }))).toBe(1);
		expect(
			weakestLaw(habit({ kind: "break", cueLocation: "bed", environment: "x", reward: "y" })),
		).toBe(2);
	});
});

describe("blueprintPatch", () => {
	test("trims, caps, empties to null; invalid times are a no-op; clearing a time turns the reminder off", () => {
		const h = habit();
		expect(blueprintPatch(h, "cueLocation", "  in bed ")).toEqual({ cueLocation: "in bed" });
		expect(blueprintPatch(h, "why", "   ")).toEqual({ why: null });
		expect(blueprintPatch(h, "bundle", "x".repeat(200))).toEqual({ bundle: "x".repeat(160) });
		expect(blueprintPatch(h, "cueTime", "7:5")).toEqual({});
		expect(blueprintPatch(h, "cueTime", " 07:05 ")).toEqual({ cueTime: "07:05" });
		expect(blueprintPatch(h, "cueTime", null)).toEqual({ cueTime: null, reminder: false });
	});

	test("clearing a break trigger clears cueLocation and stackAfter", () => {
		const h = habit({ kind: "break", stackAfter: "wake up" });
		expect(blueprintPatch(h, "cueLocation", "")).toEqual({ cueLocation: null, stackAfter: null });
		expect(blueprintPatch(h, "cueLocation", "Bed")).toEqual({ cueLocation: "Bed" });
	});
});

describe("progressLabel", () => {
	test("tracker units come from the catalog; plain and measure habits use habit.unit", () => {
		const reading = habit({ target: 10, unit: "pages", tracker: { type: "reading" } });
		expect(progressLabel(reading, 14, enT)).toBe("14/10 pages");
		expect(progressLabel(reading, 14, ptT)).toBe("14/10 páginas");
		expect(progressLabel(habit({ target: 8, unit: "glasses" }), 3, enT)).toBe("3/8 glasses");
		expect(
			progressLabel(
				habit({ target: 2, unit: "kg", tracker: { type: "measure", unit: "kg" } }),
				1,
				enT,
			),
		).toBe("1/2 kg");
		expect(progressLabel(habit({ target: 3 }), 1, enT)).toBe("1/3");
	});

	test("a tracker switched to simple check-off labels with habit.unit (Annex K §1.5)", () => {
		// A large sum target became a plain check-off: target 1, no unit.
		const detached = habit({
			target: 1,
			unit: null,
			tracker: { type: "writing", measure: "words", enabled: false },
		});
		expect(progressLabel(detached, 0, enT)).toBe("0/1");
		// A small one keeps its target and the unit word written when it was attached.
		const kept = habit({ target: 10, unit: "pages", tracker: { type: "reading", enabled: false } });
		expect(progressLabel(kept, 4, enT)).toBe("4/10 pages");
		expect(progressLabel(kept, 4, ptT)).toBe("4/10 pages");
	});
});
