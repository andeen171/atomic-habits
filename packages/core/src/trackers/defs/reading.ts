import { type DayKey, addDays } from "../../dates";
import type { Translator } from "../../i18n";
import type { FieldSpec } from "../forms";
import type { TrackerEntryIndex } from "../measure";
import { TRACKER_META } from "../meta";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, readingTrackerSchema } from "../schema";
import type { ShelfBook, SummaryBlock, SummaryContext } from "../summary";
import {
	barsChart,
	blocks,
	breakdown,
	daysOf,
	inPeriod,
	line,
	list,
	num,
	ofType,
	recentTexts,
	stat,
	str,
	sum,
	tally,
	tk,
} from "./kit";

type Config = Extract<TrackerConfig, { type: "reading" }>;

export const BOOK_STATUSES = ["reading", "next", "finished", "paused", "abandoned"] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

/** Days of recent sessions that set a book's reading pace (Annex K §1.8.2). */
const PACE_DAYS = 14;

const unitField = (config: Config) => (config.measure === "minutes" ? "minutes" : "pages");

function statusOf(book: TrackerEntry): BookStatus {
	const status = book.data.status;
	return (BOOK_STATUSES as readonly string[]).includes(status as string)
		? (status as BookStatus)
		: "reading";
}

/** The habit's live books, newest first. */
export function booksOf(index: TrackerEntryIndex, habitId: string): TrackerEntry[] {
	return ofType(index.byHabit.get(habitId) ?? [], "book");
}

/** "Deep Work", or "Deleted book" for a session whose book was removed. */
function bookTitle(bookId: unknown, books: readonly TrackerEntry[], t: Translator): string | null {
	const id = str(bookId);
	if (!id) return null;
	const book = books.find((b) => b.id === id);
	return book
		? (str(book.data.title) ?? t.t("tracker.reading.untitled"))
		: t.t("tracker.reading.deletedBook");
}

/**
 * A book on the shelf: current page `max(maxToPage, startPage + Σpages)`,
 * progress, and the finish projection from the last 14 days' pace.
 */
export function shelfBook(
	book: TrackerEntry,
	sessions: readonly TrackerEntry[],
	today: DayKey,
	t: Translator,
): ShelfBook {
	const own = sessions.filter((s) => s.type === "reading" && str(s.data.bookId) === book.id);
	const startPage = num(book.data.startPage) ?? 0;
	let maxToPage = 0;
	for (const s of own) maxToPage = Math.max(maxToPage, num(s.data.toPage) ?? 0);
	const page = Math.max(maxToPage, startPage + sum(own, "pages"));
	const pages = num(book.data.pages);
	const status = statusOf(book);
	let projection: string | null = null;
	if (status === "reading" && pages !== null && page < pages) {
		const from = addDays(today, -(PACE_DAYS - 1));
		const recent = own.filter((s) => s.date >= from && s.date <= today);
		const active = daysOf(recent.filter((s) => (num(s.data.pages) ?? 0) > 0)).size;
		const pace = active > 0 ? sum(recent, "pages") / active : 0;
		if (pace > 0) {
			const date = addDays(today, Math.ceil((pages - page) / pace));
			projection = t.t("tracker.reading.projection", { date: t.formatDayShort(date) });
		}
	}
	return {
		id: book.id,
		title: str(book.data.title) ?? t.t("tracker.reading.untitled"),
		author: str(book.data.author),
		status,
		pages,
		page,
		progress: pages ? Math.min(1, page / pages) : null,
		progressLabel: pages
			? t.t("tracker.reading.progress", { page: t.number(page), total: t.number(pages) })
			: page > 0
				? t.t("tracker.reading.page", { page: t.number(page) })
				: null,
		projection,
		rating: num(book.data.rating),
		finishedOn: str(book.data.finishedOn),
	};
}

/**
 * The shelf (Annex K §1.8.2): reading now (and paused), up next, and the
 * books finished this year. Abandoned books stay off it.
 */
export function shelf(
	all: readonly TrackerEntry[],
	today: DayKey,
	t: Translator,
): { reading: ShelfBook[]; next: ShelfBook[]; finished: ShelfBook[] } {
	const sessions = ofType(all, "reading");
	const lastRead = new Map<string, string>();
	for (const s of sessions) {
		const id = str(s.data.bookId);
		if (id && !lastRead.has(id)) lastRead.set(id, s.date);
	}
	const year = today.slice(0, 4);
	const books = ofType(all, "book").map((b) => shelfBook(b, sessions, today, t));
	const recency = (b: ShelfBook) => lastRead.get(b.id) ?? "";
	return {
		reading: books
			.filter((b) => b.status === "reading" || b.status === "paused")
			.sort((a, b) => (recency(a) < recency(b) ? 1 : recency(a) > recency(b) ? -1 : 0)),
		next: books.filter((b) => b.status === "next").reverse(),
		finished: books
			.filter((b) => b.status === "finished" && (b.finishedOn ?? "").startsWith(year))
			.sort((a, b) => ((a.finishedOn ?? "") < (b.finishedOn ?? "") ? 1 : -1)),
	};
}

const STATUS_ORDER: Readonly<Record<BookStatus, number>> = {
	reading: 0,
	paused: 1,
	next: 2,
	finished: 3,
	abandoned: 4,
};

/**
 * Every live book of a habit for the composer's book picker and the book
 * list (`useBooks`): being read first (most recently read first), then
 * paused, up next, finished and set aside.
 */
export function habitBooks(
	index: TrackerEntryIndex,
	habitId: string,
	today: DayKey,
	t: Translator,
): ShelfBook[] {
	const all = index.byHabit.get(habitId) ?? [];
	const sessions = ofType(all, "reading");
	const lastRead = new Map<string, string>();
	for (const s of sessions) {
		const id = str(s.data.bookId);
		if (id && !lastRead.has(id)) lastRead.set(id, s.date);
	}
	const books = ofType(all, "book").map((b, i) => ({
		book: shelfBook(b, sessions, today, t),
		recency: lastRead.get(b.id) ?? "",
		i,
	}));
	return books
		.sort(
			(a, b) =>
				STATUS_ORDER[a.book.status] - STATUS_ORDER[b.book.status] ||
				(a.recency < b.recency ? 1 : a.recency > b.recency ? -1 : 0) ||
				a.i - b.i,
		)
		.map(({ book }) => book);
}

function amountText(config: Config, pages: number, minutes: number, t: Translator): string {
	if (config.measure === "minutes" || (pages <= 0 && minutes > 0)) {
		return t.tp("tracker.unit.minutes", minutes);
	}
	return t.tp("tracker.unit.pages", pages);
}

function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { config, t, period } = ctx;
	const field = unitField(config);
	const sessions = inPeriod(ctx, "reading");
	const books = ofType(ctx.all, "book");
	const total = sum(sessions, field);
	const active = daysOf(sessions.filter((s) => (num(s.data[field]) ?? 0) > 0)).size;
	const average = active > 0 ? Math.round(total / active) : 0;
	const finished = books.filter((b) => {
		const day = str(b.data.finishedOn);
		return statusOf(b) === "finished" && day !== null && day >= period.from && day <= period.to;
	}).length;
	const format = (value: number) =>
		config.measure === "minutes"
			? t.tp("tracker.unit.minutes", value)
			: t.tp("tracker.unit.pages", value);
	const ownShelf = shelf(ctx.all, ctx.today, t);
	const byBook = tally(
		sessions,
		(s) => str(s.data.bookId) ?? "",
		(s) => num(s.data[field]) ?? 0,
	);
	const quotes = sessions
		.filter((s) => str(s.data.quote))
		.slice(0, 5)
		.map((s) => ({
			id: s.id,
			entryId: s.id,
			primary: `“${str(s.data.quote)}”`,
			secondary: [bookTitle(s.data.bookId, books, t), t.formatDayShort(s.date)]
				.filter(Boolean)
				.join(" · "),
		}));
	const hasShelf = ownShelf.reading.length + ownShelf.next.length + ownShelf.finished.length > 0;
	return blocks(
		hasShelf && { kind: "shelf", id: "shelf", ...ownShelf },
		{
			kind: "stats",
			id: "stats",
			items: [
				stat(
					"total",
					t.t(
						config.measure === "minutes"
							? "tracker.reading.minutesRead"
							: "tracker.reading.pagesRead",
					),
					t.number(total),
					total,
				),
				stat("average", t.t("tracker.stat.perActiveDay"), t.number(average), average),
				stat("finished", t.t("tracker.reading.booksFinishedLabel"), t.number(finished), finished),
				stat("sessions", t.t("tracker.stat.sessions"), t.number(sessions.length), sessions.length),
			],
		},
		barsChart(ctx, sessions, (s) => num(s.data[field]) ?? 0, {
			id: "perDay",
			title: t.t(
				config.measure === "minutes"
					? "tracker.reading.minutesPerDay"
					: "tracker.reading.pagesPerDay",
			),
			format: "number",
		}),
		breakdown(
			"books",
			t.t("tracker.reading.byBook"),
			[...byBook].map(([id, value]) => ({
				key: id || "none",
				label: id ? (bookTitle(id, books, t) ?? "") : t.t("tracker.reading.noBook"),
				value,
			})),
			format,
		),
		list("highlights", t.t("tracker.reading.highlights"), quotes),
	);
}

export const readingDef: TrackerDef<Config> = {
	...TRACKER_META.reading,
	emoji: "📖",
	primaryType: "reading",
	defaults: () => readingTrackerSchema.parse({ type: "reading" }) as Config,

	form(type, ctx) {
		const { config, t } = ctx;
		if (type === "book") {
			const history = booksOf(ctx.index, ctx.habit.id);
			return [
				{
					key: "title",
					kind: "text",
					label: t.t("tracker.reading.title"),
					section: "primary",
					required: true,
					max: 120,
				},
				{
					key: "author",
					kind: "text",
					label: t.t("tracker.reading.author"),
					section: "primary",
					required: false,
					max: 80,
					suggestions: recentTexts(history, "author"),
				},
				{
					key: "pages",
					kind: "number",
					label: t.t("tracker.reading.totalPages"),
					section: "primary",
					required: false,
					min: 1,
					max: 20_000,
					decimals: 0,
				},
				{
					key: "status",
					kind: "choice",
					label: t.t("tracker.reading.status"),
					section: "primary",
					required: true,
					layout: "chips",
					options: BOOK_STATUSES.map((s) => ({
						value: s,
						label: tk(t, `tracker.bookStatus.${s}`),
					})),
				},
				{
					key: "startPage",
					kind: "number",
					label: t.t("tracker.reading.startPage"),
					hint: t.t("tracker.reading.startPageHint"),
					section: "more",
					required: false,
					min: 0,
					max: 20_000,
					decimals: 0,
					emptyValue: 0,
				},
				{
					key: "rating",
					kind: "rating",
					label: t.t("tracker.reading.rating"),
					section: "more",
					required: false,
					labels: [1, 2, 3, 4, 5].map((n) => tk(t, `tracker.rating.${n}`)),
				},
			];
		}
		if (type !== "reading") return [];
		const group = { id: "amount", message: t.t("tracker.reading.needAmount") };
		const minutes: FieldSpec = {
			key: "minutes",
			kind: "duration",
			label: t.t("tracker.reading.minutes"),
			section: config.measure === "minutes" ? "primary" : "more",
			required: false,
			storeAs: "minutes",
			max: 1440,
			quick: [10, 15, 20, 30],
			group,
		};
		const pageFields: FieldSpec[] = [
			{
				key: "toPage",
				kind: "number",
				label: t.t("tracker.reading.onPage"),
				section: "primary",
				required: false,
				min: 0,
				max: 20_000,
				decimals: 0,
				group,
			},
			{
				key: "pages",
				kind: "number",
				label: t.t("tracker.reading.pages"),
				section: "primary",
				required: false,
				min: 0,
				max: 5000,
				decimals: 0,
				quick: [5, 10, 20],
				emptyValue: 0,
				group,
			},
		];
		return [
			{
				key: "bookId",
				kind: "book",
				label: t.t("tracker.reading.book"),
				section: "primary",
				required: false,
			},
			...(config.measure === "minutes" ? [minutes, ...pageFields] : [...pageFields, minutes]),
			{
				key: "quote",
				kind: "longtext",
				label: t.t("tracker.reading.quote"),
				section: "more",
				required: false,
				max: 500,
			},
		];
	},

	draft(type, ctx) {
		if (type === "book") return { status: "reading" };
		if (type !== "reading") return {};
		// The latest session's book, while it is still being read.
		const all = ctx.index.byHabit.get(ctx.habit.id) ?? [];
		const lastBook = str(ofType(all, "reading").find((s) => str(s.data.bookId))?.data.bookId);
		const book = lastBook ? all.find((b) => b.id === lastBook && b.type === "book") : undefined;
		return { bookId: book && statusOf(book) === "reading" ? book.id : null };
	},

	dayLine({ config, entries, t, index, habit }) {
		const sessions = ofType(entries, "reading");
		if (!sessions.length) return null;
		const amount = amountText(config, sum(sessions, "pages"), sum(sessions, "minutes"), t);
		const books = booksOf(index, habit.id);
		const titles = [...new Set(sessions.map((s) => bookTitle(s.data.bookId, books, t)))].filter(
			(title): title is string => Boolean(title),
		);
		return titles.length ? `${amount} · ${titles.join(", ")}` : amount;
	},

	entryLine(entry, { config, t, index, habit }) {
		if (entry.type === "book") {
			const status = tk(t, `tracker.bookStatus.${statusOf(entry)}`);
			const author = str(entry.data.author);
			return line(
				str(entry.data.title) ?? t.t("tracker.reading.untitled"),
				author ? `${author} · ${status}` : status,
				entry,
			);
		}
		const books = booksOf(index, habit.id);
		const toPage = num(entry.data.toPage);
		const secondary = [
			bookTitle(entry.data.bookId, books, t),
			toPage !== null ? t.t("tracker.reading.page", { page: t.number(toPage) }) : null,
		]
			.filter(Boolean)
			.join(" · ");
		return line(
			amountText(config, num(entry.data.pages) ?? 0, num(entry.data.minutes) ?? 0, t),
			secondary || null,
			entry,
		);
	},

	summary,

	headline(ctx) {
		const field = unitField(ctx.config);
		const total = sum(inPeriod(ctx, "reading"), field);
		if (total <= 0) return null;
		const value =
			field === "minutes"
				? ctx.t.tp("tracker.unit.minutes", total)
				: ctx.t.tp("tracker.unit.pages", total);
		return ctx.t.t("tracker.headline.month", { value });
	},
};
