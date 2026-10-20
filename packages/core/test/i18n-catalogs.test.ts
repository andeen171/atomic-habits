import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { en } from "../src/i18n/en";
import { ptBR } from "../src/i18n/pt-BR";
import { cloudEn } from "../src/i18n/v2/cloud.en";
import { cloudPtBR } from "../src/i18n/v2/cloud.pt-BR";
import { habitsEn } from "../src/i18n/v2/habits.en";
import { habitsPtBR } from "../src/i18n/v2/habits.pt-BR";
import { journalEn } from "../src/i18n/v2/journal.en";
import { journalPtBR } from "../src/i18n/v2/journal.pt-BR";
import { serverEn } from "../src/i18n/v2/server.en";
import { serverPtBR } from "../src/i18n/v2/server.pt-BR";
import { sharedEn } from "../src/i18n/v2/shared.en";
import { sharedPtBR } from "../src/i18n/v2/shared.pt-BR";
import { tasksEn } from "../src/i18n/v2/tasks.en";
import { tasksPtBR } from "../src/i18n/v2/tasks.pt-BR";
import { trackersEn } from "../src/i18n/v2/trackers.en";
import { trackersPtBR } from "../src/i18n/v2/trackers.pt-BR";
import { SRC } from "./support/import-graph";

/**
 * The v2 per-area catalogs (spec §7). Each area owns one module pair; `en.ts`
 * and `pt-BR.ts` spread them after their base literals.
 */
type Catalog = Readonly<Record<string, string>>;
const MODULES: Record<string, { en: Catalog; pt: Catalog }> = {
	shared: { en: sharedEn, pt: sharedPtBR },
	habits: { en: habitsEn, pt: habitsPtBR },
	tasks: { en: tasksEn, pt: tasksPtBR },
	journal: { en: journalEn, pt: journalPtBR },
	trackers: { en: trackersEn, pt: trackersPtBR },
	cloud: { en: cloudEn, pt: cloudPtBR },
	server: { en: serverEn, pt: serverPtBR },
};

const I18N = join(SRC, "i18n");
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

/** Keys written as literals in a catalog file (one tab deep, i.e. the object's own keys). */
function baseLiteralKeys(file: string): string[] {
	const source = readFileSync(join(I18N, file), "utf8");
	return [...source.matchAll(/^\t"([^"]+)":/gm)].map((m) => m[1] as string);
}

function duplicates(keys: readonly string[]): string[] {
	const seen = new Set<string>();
	const dupes = new Set<string>();
	for (const key of keys) (seen.has(key) ? dupes : seen).add(key);
	return [...dupes].sort();
}

describe("i18n catalogs", () => {
	test("every v2 module is registered here and in both catalogs", () => {
		const files = readdirSync(join(I18N, "v2")).sort();
		const expected = Object.keys(MODULES)
			.flatMap((area) => [`${area}.en.ts`, `${area}.pt-BR.ts`])
			.sort();
		expect(files).toEqual(expected);
		const enSource = readFileSync(join(I18N, "en.ts"), "utf8");
		const ptSource = readFileSync(join(I18N, "pt-BR.ts"), "utf8");
		for (const area of Object.keys(MODULES)) {
			expect(enSource).toContain(`...${area}En,`);
			expect(ptSource).toContain(`...${area}PtBR,`);
		}
	});

	test("no key is defined in two modules, or in a module and a base literal", () => {
		const moduleKeys = Object.values(MODULES).flatMap((m) => Object.keys(m.en));
		expect(duplicates(moduleKeys)).toEqual([]);
		for (const [file, catalog] of [
			["en.ts", en],
			["pt-BR.ts", ptBR],
		] as const) {
			const base = baseLiteralKeys(file);
			expect(duplicates(base)).toEqual([]);
			expect(duplicates([...base, ...moduleKeys])).toEqual([]);
			// The merged catalog is exactly the base literals plus the modules.
			expect(Object.keys(catalog).length).toBe(base.length + moduleKeys.length);
		}
	});

	test("each module pair has the same keys and placeholders", () => {
		for (const [area, { en: moduleEn, pt: modulePt }] of Object.entries(MODULES)) {
			expect({ area, keys: Object.keys(modulePt).sort() }).toEqual({
				area,
				keys: Object.keys(moduleEn).sort(),
			});
			for (const [key, value] of Object.entries(moduleEn)) {
				expect({ key, pt: placeholders(modulePt[key] ?? "") }).toEqual({
					key,
					pt: placeholders(value),
				});
				expect(value.trim().length).toBeGreaterThan(0);
				expect((modulePt[key] ?? "").trim().length).toBeGreaterThan(0);
			}
		}
	});

	test("module strings reach the merged catalogs unchanged", () => {
		for (const { en: moduleEn, pt: modulePt } of Object.values(MODULES)) {
			for (const [key, value] of Object.entries(moduleEn)) {
				expect((en as Catalog)[key]).toBe(value);
				expect((ptBR as Catalog)[key]).toBe(modulePt[key] as string);
			}
		}
	});

	test("en and pt-BR have the same keys, placeholders and plural pairs", () => {
		expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort());
		for (const key of Object.keys(en) as (keyof typeof en)[]) {
			expect({ key, pt: placeholders(ptBR[key]) }).toEqual({ key, pt: placeholders(en[key]) });
		}
		const keys = new Set(Object.keys(en));
		for (const key of keys) {
			if (key.endsWith(".one")) expect(keys.has(`${key.slice(0, -4)}.other`)).toBe(true);
			if (key.endsWith(".other")) expect(keys.has(`${key.slice(0, -6)}.one`)).toBe(true);
		}
	});

	test("shared keys from spec §7", () => {
		expect(en["nav.journal"]).toBe("Journal");
		expect(ptBR["nav.journal"]).toBe("Diário");
		expect(en["cue.event"]).toBe("Something I'd just done");
		expect(ptBR["tracker.unit.sessions.other"]).toBe("{count} sessões");
		expect(en["create.journalEntry"]).toBe("Journal entry");
		expect(ptBR["app.reload"]).toBe("Recarregar");
	});
});
