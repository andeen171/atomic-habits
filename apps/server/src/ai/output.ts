import {
	type AiSuggestKind,
	type AiSuggestOutput,
	type AiSuggestRequest,
	type AiTranslateRequest,
	aiSuggestOutputSchemas,
	foldText,
} from "@atomic/core";
import { z } from "zod";
import { maxTranslationLength } from "./prompts";
import { AiError } from "./provider";

/**
 * What the model said, turned into what the client gets (spec §4.5): only
 * the keys of the output schema survive (an injected extra key never
 * reaches a client), every text is cleaned, items with links, echoes of the
 * input, duplicates (by `foldText`) or out-of-range lengths are dropped,
 * never truncated, and the result must pass the shared zod output schema.
 * An answer with nothing usable left is `invalid` (retried once).
 */

const URL_RE =
	/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|app|dev|br|co|me|ly|info|xyz|link|site|ai|gg|to|tk)\b/i;

/** Contains something that looks like a link. */
export function hasUrl(text: string): boolean {
	return URL_RE.test(text);
}

/**
 * Characters a model has no reason to put in short UI text: C0 and C1
 * controls (tab and line breaks excepted; they collapse to a space), the
 * zero-width space and word joiners, the BOM, and the bidi marks,
 * embeddings, overrides and isolates, which can make a text display
 * differently from what it says. ZWJ and ZWNJ stay (emoji sequences).
 */
function isInvisible(code: number): boolean {
	return (
		(code <= 0x1f && (code < 0x09 || code > 0x0d)) ||
		(code >= 0x7f && code <= 0x9f) ||
		code === 0x200b ||
		code === 0x200e ||
		code === 0x200f ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2060 && code <= 0x2064) ||
		(code >= 0x2066 && code <= 0x2069) ||
		code === 0xfeff
	);
}

/** Drops invisible and direction-changing characters (see `isInvisible`). */
export function stripInvisible(value: string): string {
	let out = "";
	for (const char of value) {
		if (!isInvisible(char.codePointAt(0) ?? 0)) out += char;
	}
	return out;
}

const QUOTES: [string, string][] = [
	['"', '"'],
	["'", "'"],
	["“", "”"],
	["‘", "’"],
	["«", "»"],
	["`", "`"],
];

/** Drops invisible characters, trims, collapses spaces, strips wrapping quotes and a list marker. */
export function cleanText(value: string): string {
	let text = stripInvisible(value).replace(/\s+/g, " ").trim();
	for (let again = true; again && text.length >= 2; ) {
		again = false;
		for (const [open, close] of QUOTES) {
			if (text.startsWith(open) && text.endsWith(close)) {
				text = text.slice(open.length, -close.length).trim();
				again = true;
			}
		}
	}
	return text.replace(/^(?:[-*•–]\s+|\d{1,2}[.)]\s+)/, "").trim();
}

const fold = (text: string) => foldText(cleanText(text)).replace(/[.!?…]+$/, "");

/** The relaxed shape of a list answer; items are checked one by one. */
const listShape = z.looseObject({ items: z.array(z.unknown()).max(30) });

const lawsShape = z.looseObject({
	obvious: z.string(),
	attractive: z.string(),
	easy: z.string(),
	satisfying: z.string(),
});

/** The input texts an answer must not simply repeat. */
function inputTexts(request: AiSuggestRequest): string[] {
	switch (request.kind) {
		case "habit.name":
			return [request.input.partial ?? "", request.input.identity ?? ""];
		case "habit.stack":
			return [request.input.habit];
		case "habit.twoMinute":
		case "habit.intention":
			return [request.input.habit];
		case "habit.laws":
		case "habit.setupTasks":
			return [request.input.habit, request.input.identity ?? ""];
		case "identity.statement":
			return [request.input.goal];
		case "task.firstStep":
			return [request.input.task];
	}
}

type ListKind = Exclude<AiSuggestKind, "habit.laws">;

/** Most items per list kind (as in the core output schemas, which have the final say). */
const MAX_ITEMS: Record<ListKind, number> = {
	"habit.name": 5,
	"habit.twoMinute": 4,
	"habit.intention": 3,
	"habit.stack": 4,
	"habit.setupTasks": 5,
	"identity.statement": 4,
	"task.firstStep": 3,
};

/** "7:30" → "07:30"; blank → null (small models drop the leading zero). */
function clockTime(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const time = value.trim();
	if (!time || /^null$/i.test(time)) return null;
	return /^\d:\d\d$/.test(time) ? `0${time}` : time;
}

/** Keeps exactly the schema's keys of an item, cleaned. */
function pickItem(kind: AiSuggestKind, raw: unknown): unknown {
	if (typeof raw === "string") return cleanText(raw);
	if (!raw || typeof raw !== "object") return raw;
	const r = raw as Record<string, unknown>;
	const str = (value: unknown) => (typeof value === "string" ? cleanText(value) : value);
	if (kind === "habit.intention") {
		return { time: clockTime(r.time), location: str(r.location), sentence: str(r.sentence) };
	}
	if (kind === "habit.setupTasks") {
		const law = typeof r.law === "string" && /^[1-4]$/.test(r.law.trim()) ? Number(r.law) : r.law;
		return { title: str(r.title), law };
	}
	return raw;
}

/** The text an item is compared by (dedupe, echo). */
function itemKey(item: unknown): string {
	if (typeof item === "string") return item;
	const r = item as Record<string, unknown>;
	return String(r.sentence ?? r.title ?? "");
}

function itemTexts(item: unknown): string[] {
	if (typeof item === "string") return [item];
	return Object.values(item as Record<string, unknown>).filter(
		(v): v is string => typeof v === "string",
	);
}

/** Validated, cleaned suggestions; throws `AiError("invalid")` when nothing is usable. */
export function processSuggestion(
	request: AiSuggestRequest,
	value: unknown,
): AiSuggestOutput<AiSuggestKind> {
	const echoes = new Set(inputTexts(request).filter(Boolean).map(fold));
	const kind: AiSuggestKind = request.kind;
	if (kind === "habit.laws") {
		const shape = lawsShape.safeParse(value);
		if (!shape.success) throw new AiError("invalid");
		const laws = {
			obvious: cleanText(shape.data.obvious),
			attractive: cleanText(shape.data.attractive),
			easy: cleanText(shape.data.easy),
			satisfying: cleanText(shape.data.satisfying),
		};
		const texts = Object.values(laws);
		if (texts.some((text) => hasUrl(text) || echoes.has(fold(text)))) {
			throw new AiError("invalid");
		}
		const result = aiSuggestOutputSchemas["habit.laws"].safeParse(laws);
		if (!result.success) throw new AiError("invalid");
		return laws;
	}
	const list = listShape.safeParse(Array.isArray(value) ? { items: value } : value);
	if (!list.success) throw new AiError("invalid");
	const itemSchema: z.ZodType = aiSuggestOutputSchemas[kind].shape.items.element;
	const max = MAX_ITEMS[kind];
	const seen = new Set<string>();
	const items: unknown[] = [];
	for (const raw of list.data.items) {
		if (items.length >= max) break;
		const item = pickItem(kind, raw);
		if (!itemSchema.safeParse(item).success) continue; // too short or long, wrong shape
		if (itemTexts(item).some(hasUrl)) continue;
		const key = fold(itemKey(item));
		if (!key || echoes.has(key) || seen.has(key)) continue;
		seen.add(key);
		items.push(item);
	}
	const output = { items };
	if (!aiSuggestOutputSchemas[kind].safeParse(output).success) throw new AiError("invalid");
	return output as AiSuggestOutput<AiSuggestKind>;
}

/**
 * Drops invisible characters and collapses spaces; wrapping quotes the
 * source didn't have are the model's, not the user's.
 */
function cleanTranslation(source: string, raw: string): string {
	let text = stripInvisible(raw).replace(/\s+/g, " ").trim();
	const quoted = QUOTES.some(([open]) => source.trim().startsWith(open));
	if (quoted) return text;
	for (const [open, close] of QUOTES) {
		if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
			text = text.slice(open.length, -close.length).trim();
		}
	}
	return text;
}

const translateShape = z.looseObject({
	items: z.array(z.looseObject({ n: z.coerce.number().int(), text: z.string() })).max(30),
});

/**
 * Translations by request id. The answer must hold every item exactly once
 * (the id set equals the request's), each text within 2 × its source + 40,
 * and no link the source didn't have; otherwise `invalid`.
 */
export function processTranslation(
	request: AiTranslateRequest,
	value: unknown,
): { id: string; text: string }[] {
	const shape = translateShape.safeParse(value);
	if (!shape.success) throw new AiError("invalid");
	const { items } = request;
	const texts = new Map<number, string>();
	for (const entry of shape.data.items) {
		if (entry.n < 1 || entry.n > items.length || texts.has(entry.n)) {
			throw new AiError("invalid");
		}
		texts.set(entry.n, entry.text);
	}
	if (texts.size !== items.length) throw new AiError("invalid");
	return items.map((item, i) => {
		const text = cleanTranslation(item.text, texts.get(i + 1) ?? "");
		if (!text || text.length > maxTranslationLength(item.text)) throw new AiError("invalid");
		if (hasUrl(text) && !hasUrl(item.text)) throw new AiError("invalid");
		return { id: item.id, text };
	});
}
