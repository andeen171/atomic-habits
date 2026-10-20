import { type DayKey, addDays, parseDayKey, parseTime } from "../dates";
import type { Locale } from "../i18n";
import type { AtomicData, Habit, HabitLog } from "../model";
import { CUE_TYPES } from "../primitives";
import { countWords } from "./format";
import { dayCountFor } from "./measure";
import { knownTracker, trackerStart } from "./meta";
import { type TrackerConfig, type TrackerEntry, trackerEntryKeyId } from "./schema";

/**
 * Sample tracker entries for the demo (spec §3.1, `demo.ts`). Used only
 * while the template flags put trackers on the demo habits. Each logged day
 * of a tracker habit gets entries, and its log count is re-derived with
 * `dayCountFor`, so loading the demo needs no reconcile writes.
 *
 * Runtime imports: `dates`, `primitives`, tracker modules (never `demo.ts`).
 */

export interface DemoTrackerInput {
	/** The demo's habits and logs (read, not mutated). */
	data: Pick<AtomicData, "habits" | "logs">;
	today: DayKey;
	locale: Locale;
	/** `createdAt` / `updatedAt` of every sample record. */
	createdAt: number;
	seed?: number;
}

export interface DemoTrackerData {
	trackerEntries: Record<string, TrackerEntry>;
	/** The logs of tracker days, with counts derived from their entries. */
	logs: Record<string, HabitLog>;
}

function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Draft = Pick<TrackerEntry, "type" | "data"> & { id?: string; hour?: number };

const COPY = {
	en: {
		expenseNotes: ["Coffee", "Groceries", "Bus pass", "Lunch with Ana", "Cinema", "Light bulbs"],
		people: ["Mom", "Ana", "Grandma", "Leo"],
		pages: ["One line about today: calm morning.", "Grateful for a long walk.", "Slept well."],
		books: [
			{ title: "Atomic Habits", author: "James Clear", pages: 320 },
			{ title: "Deep Work", author: "Cal Newport", pages: 296 },
		],
	},
	"pt-BR": {
		expenseNotes: ["Café", "Mercado", "Passagem", "Almoço com a Ana", "Cinema", "Lâmpadas"],
		people: ["Mãe", "Ana", "Vó", "Léo"],
		pages: ["Uma linha sobre hoje: manhã calma.", "Grato por uma caminhada longa.", "Dormi bem."],
		books: [
			{ title: "Hábitos Atômicos", author: "James Clear", pages: 320 },
			{ title: "Trabalho Focado", author: "Cal Newport", pages: 296 },
		],
	},
} as const;

const EXPENSE_CATEGORIES = ["food", "groceries", "transport", "fun", "home"] as const;
const ACTIVITIES = ["run", "walk", "strength", "cycling", "yoga"] as const;
const DISTANCE_ACTIVITIES: ReadonlySet<string> = new Set(["run", "walk", "cycling"]);
const CHANNELS = ["call", "video", "visit", "message"] as const;

/**
 * Entries for every logged day of the demo's tracker habits, plus those
 * days' logs with their counts derived from the entries. The expense habit
 * also gets a few "No spending today" days. Deterministic per seed.
 */
export function buildDemoTrackerEntries(input: DemoTrackerInput): DemoTrackerData {
	const { data, today, locale, createdAt } = input;
	const random = mulberry32(input.seed ?? 20_261_020);
	const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
	const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
	const copy = COPY[locale];
	const trackerEntries: Record<string, TrackerEntry> = {};
	const logs: Record<string, HabitLog> = {};

	const habits = Object.values(data.habits)
		.filter((habit) => !habit.deletedAt && knownTracker(habit)?.enabled !== false)
		.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
	const logsByHabit = new Map<string, HabitLog[]>();
	for (const log of Object.values(data.logs)) {
		if (log.deletedAt) continue;
		const list = logsByHabit.get(log.habitId) ?? [];
		list.push(log);
		logsByHabit.set(log.habitId, list);
	}

	for (const habit of habits) {
		const config = knownTracker(habit);
		if (!config) continue;
		const start = trackerStart(habit);
		const key = habit.id.replace(/^demo-habit-/, "");
		let n = 0;
		const add = (date: DayKey, draft: Draft): TrackerEntry => {
			const id = draft.id ?? `demo-entry-${key}-${n++}`;
			const at =
				draft.hour === undefined ? null : parseDayKey(date).getTime() + draft.hour * 3_600_000;
			const entry: TrackerEntry = {
				id,
				habitId: habit.id,
				date,
				type: draft.type,
				at,
				data: draft.data,
				createdAt,
				updatedAt: createdAt,
				deletedAt: null,
			};
			trackerEntries[id] = entry;
			return entry;
		};
		const books = config.type === "reading" ? shelf(start, add, copy) : null;
		let pagesRead = 0;

		const days = new Map<DayKey, HabitLog | null>();
		for (const log of logsByHabit.get(habit.id) ?? []) {
			if (log.count > 0 && log.date >= start && log.date <= today) days.set(log.date, log);
		}
		if (config.type === "expense") {
			// A few "No spending today" days in the last month.
			for (let offset = 1; offset <= 30; offset++) {
				const date = addDays(today, -offset);
				if (date >= start && !days.has(date) && random() < 0.35) days.set(date, null);
			}
		}

		for (const date of [...days.keys()].sort()) {
			const log = days.get(date) ?? null;
			const drafts = log
				? dayDrafts(config, habit, log.count, {
						random,
						pick,
						between,
						copy,
						date,
						bookFor: (pages) => {
							if (!books) return null;
							pagesRead += pages;
							return books.sessionAt(pagesRead, date);
						},
					})
				: [{ id: trackerEntryKeyId(habit.id, "none", date), type: "none", data: { note: null } }];
			if (!drafts.length) continue;
			const day = drafts.map((draft) => add(date, draft));
			const count = dayCountFor(habit, day) ?? 0;
			const id = `${habit.id}:${date}`;
			logs[id] = log
				? { ...log, count }
				: {
						id,
						habitId: habit.id,
						date,
						count,
						skipped: false,
						note: null,
						createdAt,
						updatedAt: createdAt,
						deletedAt: null,
					};
		}
	}
	return { trackerEntries, logs };
}

interface DraftContext {
	random: () => number;
	pick: <T>(list: readonly T[]) => T;
	between: (min: number, max: number) => number;
	copy: (typeof COPY)[Locale];
	date: DayKey;
	/** Records `pages` read on `date`; the book and bookmark of that session. */
	bookFor: (pages: number) => { bookId: string; toPage: number } | null;
}

/** The entries of one logged day (its count is re-derived from them). */
function dayDrafts(config: TrackerConfig, habit: Habit, count: number, ctx: DraftContext): Draft[] {
	const { random, pick, between, copy } = ctx;
	switch (config.type) {
		case "expense": {
			const drafts: Draft[] = [];
			const items = between(1, 3);
			for (let i = 0; i < items; i++) {
				drafts.push({
					type: "expense",
					hour: between(8, 20),
					data: {
						amount: between(5, 90) * 100 + pick([0, 50, 90]),
						currency: config.currency,
						category: pick(EXPENSE_CATEGORIES),
						note: pick(copy.expenseNotes),
						photos: [],
					},
				});
			}
			return drafts;
		}
		case "reading": {
			if (config.measure === "minutes") {
				return [{ type: "reading", hour: 21, data: { pages: 0, minutes: count, quote: null } }];
			}
			const bookmark = ctx.bookFor(count);
			return [
				{
					type: "reading",
					hour: 21,
					data: {
						pages: count,
						bookId: bookmark?.bookId ?? null,
						toPage: bookmark?.toPage ?? null,
						minutes: null,
						quote: null,
					},
				},
			];
		}
		case "workout": {
			const activity = config.defaultActivity ?? pick(ACTIVITIES);
			const minutes = between(20, 60);
			return [
				{
					type: "workout",
					hour: between(6, 19),
					data: {
						activity,
						minutes,
						distance: DISTANCE_ACTIVITIES.has(activity) ? minutes * between(90, 160) : null,
						effort: between(2, 4),
						note: null,
						photos: [],
					},
				},
			];
		}
		case "session": {
			const label = config.labels.length ? pick(config.labels) : null;
			if (config.measure === "sessions") {
				return Array.from({ length: count }, () => ({
					type: "session",
					hour: between(7, 21),
					data: { seconds: between(10, 30) * 60, label, note: null, mode: "stopwatch" },
				}));
			}
			return [
				{
					type: "session",
					hour: 7,
					data: { seconds: count * 60 + between(0, 50), label, note: null, mode: "timer" },
				},
			];
		}
		case "writing": {
			if (config.measure === "entries") {
				const text = pick(copy.pages);
				return [
					{
						type: "writing",
						hour: 22,
						data: { text, words: countWords(text), title: null, project: null },
					},
				];
			}
			return [
				{
					type: "writing",
					hour: 9,
					data: { text: null, words: count, title: null, project: null },
				},
			];
		}
		case "wake": {
			const deadline = Math.min(1439, (parseTime(config.time) ?? 390) + config.grace);
			return [
				{
					id: trackerEntryKeyId(habit.id, "wake", ctx.date),
					type: "wake",
					data: { minutes: Math.max(0, deadline - between(2, 25)), deadline, note: null },
				},
			];
		}
		case "sleep": {
			let bedtime = parseTime(config.bedtime) ?? 1380;
			if (bedtime < 300) bedtime += 1440;
			const deadline = Math.min(2159, bedtime + config.grace);
			const bed = Math.max(0, deadline - between(0, 40));
			return [
				{
					id: trackerEntryKeyId(habit.id, "sleep", ctx.date),
					type: "sleep",
					data: { bed, wake: bed + between(400, 500), deadline, quality: between(3, 5) },
				},
			];
		}
		case "connection":
			return [
				{
					type: "connection",
					hour: between(12, 21),
					data: {
						person: pick(copy.people),
						channel: pick(CHANNELS),
						minutes: between(5, 45),
						note: null,
						photos: [],
					},
				},
			];
		case "slip":
			return Array.from({ length: count }, () => ({
				type: "slip",
				hour: between(9, 23),
				data: {
					cue: pick(CUE_TYPES),
					note: null,
					cost:
						config.cost === "money"
							? between(20, 150) * 100
							: config.cost === "time"
								? between(15, 90)
								: null,
					currency: config.cost === "money" ? config.currency : null,
				},
			}));
		case "photo":
			// Photos need real blobs; a meal log (photo optional) gets captions.
			if (config.photoRequired !== false) return [];
			return [
				{
					type: "photo",
					hour: 13,
					data: { photos: [], caption: random() < 0.5 ? "🥗" : "🥦" },
				},
			];
		case "measure":
			return [{ type: "measure", hour: 8, data: { value: count, note: null } }];
		default:
			// plan: needs tasks; not in the demo.
			return [];
	}
}

/** Two books read one after the other; sessions fill the first, then the second. */
function shelf(
	start: DayKey,
	add: (date: DayKey, draft: Draft) => TrackerEntry,
	copy: (typeof COPY)[Locale],
) {
	const [first, second] = copy.books;
	const firstBook = add(start, {
		type: "book",
		data: {
			...first,
			startPage: 0,
			status: "reading",
			finishedOn: null,
			rating: null,
			cover: null,
		},
	});
	const secondBook = add(start, {
		type: "book",
		data: { ...second, startPage: 0, status: "next", finishedOn: null, rating: null, cover: null },
	});
	return {
		sessionAt(pagesRead: number, date: DayKey): { bookId: string; toPage: number } {
			if (pagesRead <= first.pages) {
				if (pagesRead === first.pages) finish(firstBook, date);
				return { bookId: firstBook.id, toPage: pagesRead };
			}
			if (firstBook.data.status !== "finished") finish(firstBook, date);
			if (secondBook.data.status === "next")
				secondBook.data = { ...secondBook.data, status: "reading" };
			return { bookId: secondBook.id, toPage: Math.min(second.pages, pagesRead - first.pages) };
		},
	};
	function finish(book: TrackerEntry, date: DayKey) {
		book.data = { ...book.data, status: "finished", finishedOn: date, rating: 5 };
	}
}
