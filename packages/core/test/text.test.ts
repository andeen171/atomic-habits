import { describe, expect, test } from "bun:test";
import { FEATURES } from "../src/flags";
import { capitalizeFirst, collapseSpaces, foldText } from "../src/text";

describe("text", () => {
	test("foldText lower-cases and strips Latin diacritics", () => {
		expect(foldText("Ação")).toBe("acao");
		expect(foldText("ÉTÉ À PARIS")).toBe("ete a paris");
		expect(foldText("Coração, pão e maçã")).toBe("coracao, pao e maca");
		expect(foldText("Łódź Żółć Ñandú İstanbul")).toBe("lodz zolc nandu istanbul");
		expect(foldText("Read 10 pages 📖")).toBe("read 10 pages 📖");
	});

	test("foldText keeps the length, so match indices map back to the original", () => {
		for (const s of ["İstanbul", "Ação", "naïve café", "📖 Leitura", "ΣΊΣΥΦΟΣ", "ß ẞ"]) {
			expect(foldText(s).length).toBe(s.length);
		}
		const original = "Meditação guiada";
		const at = foldText(original).indexOf("guiada");
		expect(original.slice(at)).toBe("guiada");
	});

	test("capitalizeFirst and collapseSpaces", () => {
		expect(capitalizeFirst("read")).toBe("Read");
		expect(capitalizeFirst("água")).toBe("Água");
		expect(capitalizeFirst("")).toBe("");
		expect(collapseSpaces("  a \n\t b  c ")).toBe("a b c");
	});

	test("feature flags start off", () => {
		expect(FEATURES).toEqual({
			templateTrackers: false,
			trackerPhaseB: false,
			trackerPhotos: false,
		});
	});
});
