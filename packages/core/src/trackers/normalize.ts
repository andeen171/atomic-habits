import { type DayKey, parseTime } from "../dates";
import { countWords } from "./format";
import type { TrackerConfig, TrackerEntry } from "./schema";

/**
 * Save-time fields of a tracker entry (spec §3.1; Annex K §3.1 `normalize`).
 * They are computed once, when the entry is written, and stored: editing an
 * older session never cascades into later ones, and a threshold entry keeps
 * the deadline that applied when it was logged.
 *
 * Runtime imports: `dates`, `format`.
 */

/** An entry as an action is about to write it (before validation). */
export interface TrackerEntryDraft {
	/** The entry's id when it already has one (updates, unique-per-day types). */
	id?: string;
	habitId: string;
	date: DayKey;
	type: string;
	at: number | null;
	data: Record<string, unknown>;
}

export interface NormalizeContext {
	/** The habit's (known) tracker. */
	config: TrackerConfig;
	/** The tracker entries of the store (for the reading bookmark). */
	entries: Readonly<Record<string, TrackerEntry>>;
	/** The moment of a draft without `at` (orders it among the day's sessions). */
	now?: number;
}

const MAX_PAGES_PER_SESSION = 5000;
const MAX_WORDS = 100_000;
const MAX_PLAN_ITEMS = 5;
const MAX_PLAN_TEXT = 280;
/** Bedtimes before 05:00 belong to the night before (+24 h). */
const NIGHT_ENDS_AT = 5 * 60;

const isNum = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const momentOf = (entry: { at: number | null; createdAt?: number }): number =>
	entry.at ?? entry.createdAt ?? 0;

/**
 * The page a book was left on before a session (Annex K §1.8.2):
 * `max(previous toPage, startPage)` over the live sessions of the same book
 * (or of no book) that happened before it.
 */
function lastPage(draft: TrackerEntryDraft, ctx: NormalizeContext): number {
	const bookId = typeof draft.data.bookId === "string" ? draft.data.bookId : null;
	let last = 0;
	if (bookId) {
		const book = ctx.entries[bookId];
		const start = book && !book.deletedAt ? book.data.startPage : null;
		if (isNum(start)) last = start;
	}
	const moment = draft.at ?? ctx.now ?? Number.POSITIVE_INFINITY;
	for (const entry of Object.values(ctx.entries)) {
		if (entry.deletedAt || entry.type !== "reading" || entry.id === draft.id) continue;
		if (entry.habitId !== draft.habitId) continue;
		const other = typeof entry.data.bookId === "string" ? entry.data.bookId : null;
		if (other !== bookId) continue;
		const before =
			entry.date < draft.date || (entry.date === draft.date && momentOf(entry) <= moment);
		if (!before) continue;
		const toPage = entry.data.toPage;
		if (isNum(toPage) && toPage > last) last = toPage;
	}
	return last;
}

/** Trimmed text, null when empty or absent; other values pass for the schema to judge. */
function trimmedOrNull(value: unknown): unknown {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

/**
 * Computes the save-time fields of a draft:
 * - expense: the currency defaults to the tracker's;
 * - reading: `pages = max(0, toPage − lastPage(book))` when a bookmark is given;
 * - writing: `words = countWords(text)` when there is text;
 * - wake / sleep: the deadline snapshot (target + grace) when missing;
 * - plan: items trimmed (empty ones dropped, at most 5), reflection trimmed.
 * Returns a new draft; other types pass through.
 */
export function normalizeTrackerEntry(
	draft: TrackerEntryDraft,
	ctx: NormalizeContext,
): TrackerEntryDraft {
	const { config } = ctx;
	const data = { ...draft.data };
	switch (draft.type) {
		case "expense": {
			const currency = typeof data.currency === "string" ? data.currency.trim().toUpperCase() : "";
			data.currency = /^[A-Z]{3}$/.test(currency)
				? currency
				: config.type === "expense"
					? config.currency
					: "USD";
			break;
		}
		case "reading": {
			if (isNum(data.toPage)) {
				const pages = Math.max(0, Math.floor(data.toPage) - lastPage({ ...draft, data }, ctx));
				data.pages = Math.min(MAX_PAGES_PER_SESSION, pages);
			}
			break;
		}
		case "writing": {
			if (typeof data.text === "string") data.words = Math.min(MAX_WORDS, countWords(data.text));
			break;
		}
		case "wake": {
			if (!isNum(data.deadline) && config.type === "wake") {
				const time = parseTime(config.time) ?? 6 * 60 + 30;
				data.deadline = Math.min(1439, time + config.grace);
			}
			break;
		}
		case "sleep": {
			if (!isNum(data.deadline) && config.type === "sleep") {
				let bedtime = parseTime(config.bedtime) ?? 23 * 60;
				if (bedtime < NIGHT_ENDS_AT) bedtime += 1440;
				data.deadline = Math.min(2159, bedtime + config.grace);
			}
			break;
		}
		case "plan": {
			if (Array.isArray(data.items)) {
				data.items = data.items
					.map((item) => {
						const raw = typeof item === "string" ? { text: item } : (item as object | null);
						if (!raw || typeof raw !== "object") return null;
						const text = (raw as { text?: unknown }).text;
						if (typeof text !== "string" || !text.trim()) return null;
						const taskId = (raw as { taskId?: unknown }).taskId;
						return {
							...raw,
							text: text.trim().slice(0, MAX_PLAN_TEXT),
							taskId: typeof taskId === "string" ? taskId : null,
						};
					})
					.filter((item) => item !== null)
					.slice(0, MAX_PLAN_ITEMS);
			}
			if ("reflection" in data) data.reflection = trimmedOrNull(data.reflection);
			break;
		}
	}
	return { ...draft, data };
}
