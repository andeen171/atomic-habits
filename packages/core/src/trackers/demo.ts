import { type DayKey, addDays, parseDayKey, parseTime, weekdayOf } from "../dates";
import type { Locale } from "../i18n";
import type { AtomicData, Habit, HabitLog, Task } from "../model";
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
	/** The clock (plan tasks done today are completed before it); default: today's noon. */
	now?: number;
	seed?: number;
}

export interface DemoTrackerData {
	trackerEntries: Record<string, TrackerEntry>;
	/** The logs of tracker days, with counts derived from their entries. */
	logs: Record<string, HabitLog>;
	/**
	 * The tasks plan entries created (`habitId: null`, `sourceEntryId` = the
	 * plan, D17): mostly done, a couple still open, older misses deleted.
	 */
	tasks: Record<string, Task>;
	/**
	 * Tracker habits whose config the demo fills in: the expense log gets a
	 * monthly budget a little above its usual spending, so the budget bar and
	 * "R$ 320 left this month" show.
	 */
	habits: Record<string, Habit>;
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
		/** One per `PURCHASES` row, in the same order. */
		expenseNotes: ["Coffee", "Weekly shop", "Bus fare", "Lunch with Ana", "Cinema", "Light bulbs"],
		people: ["Mom", "Ana", "Grandma", "Leo"],
		/** The connection log's circle: Grandma (index 2 of `people`) is overdue. */
		circle: [
			{ name: "Mom", emoji: "👩", every: 7 },
			{ name: "Grandma", emoji: "👵", every: 14 },
			{ name: "Leo", emoji: "🧑", every: 21 },
		],
		moments: [
			"Talked about the garden",
			"Planned the trip in May",
			"Laughed at old photos",
			"Heard all about the new job",
		],
		pages: ["One line about today: calm morning.", "Grateful for a long walk.", "Slept well."],
		/** Read in this order; the one in progress at the end is "Reading now", the rest "Up next". */
		books: [
			{
				title: "Atomic Habits",
				author: "James Clear",
				pages: 320,
				quotes: [
					"Every action you take is a vote for the type of person you wish to become.",
					"You do not rise to the level of your goals. You fall to the level of your systems.",
				],
			},
			{
				title: "Essentialism",
				author: "Greg McKeown",
				pages: 272,
				quotes: ["If you don't prioritize your life, someone else will."],
			},
			{ title: "Deep Work", author: "Cal Newport", pages: 296, quotes: [] },
			{
				title: "Mindset",
				author: "Carol S. Dweck",
				pages: 320,
				quotes: ["Becoming is better than being."],
			},
			{ title: "The Power of Habit", author: "Charles Duhigg", pages: 371, quotes: [] },
		],
		priorities: [
			"Send the project update",
			"Gym at 7",
			"Call the bank",
			"Finish chapter 3",
			"Book the dentist",
			"Clean the inbox",
			"Buy a birthday gift",
			"Review the budget",
		],
		meals: ["Salad with lunch", "Broccoli and rice", "Veggie soup", "Carrots as a snack"],
	},
	"pt-BR": {
		expenseNotes: [
			"Café",
			"Compras da semana",
			"Passagem de ônibus",
			"Almoço com a Ana",
			"Cinema",
			"Lâmpadas",
		],
		people: ["Mãe", "Ana", "Vó", "Léo"],
		circle: [
			{ name: "Mãe", emoji: "👩", every: 7 },
			{ name: "Vó", emoji: "👵", every: 14 },
			{ name: "Léo", emoji: "🧑", every: 21 },
		],
		moments: [
			"Falamos da horta",
			"Planejamos a viagem de maio",
			"Rimos de fotos antigas",
			"Ouvi tudo sobre o emprego novo",
		],
		pages: ["Uma linha sobre hoje: manhã calma.", "Grato por uma caminhada longa.", "Dormi bem."],
		books: [
			{
				title: "Hábitos Atômicos",
				author: "James Clear",
				pages: 320,
				quotes: [
					"Cada ação que você realiza é um voto no tipo de pessoa que deseja se tornar.",
					"Você não se eleva ao nível das suas metas. Você cai ao nível dos seus sistemas.",
				],
			},
			{
				title: "Essencialismo",
				author: "Greg McKeown",
				pages: 272,
				quotes: ["Se você não priorizar sua vida, outra pessoa o fará."],
			},
			{ title: "Trabalho Focado", author: "Cal Newport", pages: 296, quotes: [] },
			{
				title: "Mindset",
				author: "Carol S. Dweck",
				pages: 312,
				quotes: ["Tornar-se é melhor do que ser."],
			},
			{ title: "O Poder do Hábito", author: "Charles Duhigg", pages: 408, quotes: [] },
		],
		priorities: [
			"Enviar a atualização do projeto",
			"Academia às 7",
			"Ligar para o banco",
			"Terminar o capítulo 3",
			"Marcar o dentista",
			"Limpar a caixa de entrada",
			"Comprar um presente de aniversário",
			"Revisar o orçamento",
		],
		meals: ["Salada no almoço", "Brócolis com arroz", "Sopa de legumes", "Cenoura de lanche"],
	},
} as const;

const HOUR_MS = 3_600_000;
/** Plan tasks start after the demo's own tasks. */
const PLAN_TASK_ORDER = 1000;

/**
 * Sample purchases (the notes in `COPY.expenseNotes`, same order): each one's
 * category and a plausible price range in major units, so "Coffee" is never
 * filed under Home or priced like the groceries.
 */
const PURCHASES = [
	{ category: "food", min: 3, max: 7 },
	{ category: "groceries", min: 25, max: 95 },
	{ category: "transport", min: 3, max: 6 },
	{ category: "food", min: 14, max: 38 },
	{ category: "fun", min: 12, max: 28 },
	{ category: "home", min: 8, max: 24 },
] as const;
const ACTIVITIES = ["run", "walk", "strength", "cycling", "yoga"] as const;
const DISTANCE_ACTIVITIES: ReadonlySet<string> = new Set(["run", "walk", "cycling"]);
const CHANNELS = ["call", "video", "visit", "message"] as const;
/** Days since the demo's last call with Grandma (her rhythm is every 14 days). */
const OVERDUE_DAYS = 20;

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
	const now = input.now ?? parseDayKey(today).getTime() + 12 * HOUR_MS;
	const trackerEntries: Record<string, TrackerEntry> = {};
	const logs: Record<string, HabitLog> = {};
	const tasks: Record<string, Task> = {};
	/** A plan line's task: done with 80% odds, today's first line done already. */
	const planTask = (
		habit: Habit,
		entry: TrackerEntry,
		line: { text: string; index: number },
		forDay: DayKey,
	): string => {
		const id = `demo-plan-task-${Object.keys(tasks).length}`;
		const dayStart = parseDayKey(forDay).getTime();
		let completedAt: number | null = null;
		let deletedAt: number | null = null;
		if (forDay < today) {
			if (random() < 0.8) completedAt = dayStart + between(9, 18) * HOUR_MS;
			// Older misses were cleared; the last couple of days' are still open.
			else if (forDay < addDays(today, -2)) deletedAt = dayStart + 21 * HOUR_MS;
		} else if (forDay === today && line.index === 0) {
			completedAt = Math.max(parseDayKey(today).getTime(), now - HOUR_MS);
		}
		tasks[id] = {
			id,
			title: line.text,
			notes: null,
			date: forDay,
			priority: 2,
			completedAt,
			identityId: habit.identityId,
			order: PLAN_TASK_ORDER + Object.keys(tasks).length,
			repeat: null,
			time: null,
			habitId: null,
			law: null,
			habitField: null,
			sourceEntryId: entry.id,
			lang: locale,
			createdAt,
			updatedAt: Math.max(createdAt, completedAt ?? deletedAt ?? createdAt),
			deletedAt,
		};
		return id;
	};

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
			if (config.type === "plan" && log) {
				// The evening's plan for the next working day; its lines become tasks.
				const forDay = addDays(date, weekdayOf(date) === 5 ? 3 : 1);
				const entry = add(date, {
					id: trackerEntryKeyId(habit.id, "plan", date),
					type: "plan",
					hour: 21,
					data: { items: [], for: forDay, reflection: null },
				});
				const lines = new Set<string>();
				const size = Math.min(config.size, between(2, 3));
				while (lines.size < size) lines.add(pick(copy.priorities));
				entry.data = {
					...entry.data,
					items: [...lines].map((text, index) => ({
						text,
						taskId: planTask(habit, entry, { text, index }, forDay),
					})),
				};
				const count = dayCountFor(habit, [entry]) ?? 0;
				logs[log.id] = { ...log, count };
				continue;
			}
			const drafts = log
				? dayDrafts(config, habit, log.count, {
						random,
						pick,
						between,
						copy,
						date,
						today,
						bookFor: (pages) => {
							if (!books) return null;
							return books.sessionAt(pages, date);
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
	return {
		trackerEntries,
		logs,
		tasks,
		habits: { ...demoBudgets(habits, trackerEntries, today), ...demoCircles(habits, copy) },
	};
}

/**
 * The expense logs' monthly budget: the last 30 days' spending, scaled to a
 * month and rounded up to the next 100 with ~15% headroom (none without
 * spending). Budgets are config only; they never change a day's count.
 */
function demoBudgets(
	habits: readonly Habit[],
	entries: Record<string, TrackerEntry>,
	today: DayKey,
): Record<string, Habit> {
	const out: Record<string, Habit> = {};
	const from = addDays(today, -30);
	for (const habit of habits) {
		const config = knownTracker(habit);
		if (config?.type !== "expense" || config.budget !== null) continue;
		let spent = 0;
		for (const entry of Object.values(entries)) {
			if (entry.habitId !== habit.id || entry.type !== "expense") continue;
			if (entry.date < from || entry.date >= today) continue;
			if (entry.data.currency !== config.currency) continue;
			spent += Number(entry.data.amount) || 0;
		}
		if (spent <= 0) continue;
		const budget = Math.ceil((spent * 1.15) / 10_000) * 10_000;
		out[habit.id] = { ...habit, tracker: { ...config, budget } };
	}
	return out;
}

/** The connection logs' circle (people and how often to reach out), when it's empty. */
function demoCircles(habits: readonly Habit[], copy: (typeof COPY)[Locale]): Record<string, Habit> {
	const out: Record<string, Habit> = {};
	for (const habit of habits) {
		const config = knownTracker(habit);
		if (config?.type !== "connection" || config.circle.length) continue;
		out[habit.id] = {
			...habit,
			tracker: { ...config, circle: copy.circle.map((member) => ({ ...member })) },
		};
	}
	return out;
}

interface DraftContext {
	random: () => number;
	pick: <T>(list: readonly T[]) => T;
	between: (min: number, max: number) => number;
	copy: (typeof COPY)[Locale];
	date: DayKey;
	today: DayKey;
	/** Records `pages` read on `date`; the book and bookmark of that session. */
	bookFor: (pages: number) => { bookId: string; toPage: number; quote: string | null } | null;
}

/** The entries of one logged day (its count is re-derived from them). */
function dayDrafts(config: TrackerConfig, habit: Habit, count: number, ctx: DraftContext): Draft[] {
	const { random, pick, between, copy } = ctx;
	switch (config.type) {
		case "expense": {
			const drafts: Draft[] = [];
			const items = between(1, 3);
			for (let i = 0; i < items; i++) {
				const which = Math.floor(random() * PURCHASES.length);
				const purchase = PURCHASES[which] ?? PURCHASES[0];
				drafts.push({
					type: "expense",
					hour: between(8, 20),
					data: {
						amount: between(purchase.min, purchase.max) * 100 + pick([0, 50, 90]),
						currency: config.currency,
						category: purchase.category,
						note: copy.expenseNotes[which] ?? null,
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
						quote: bookmark?.quote ?? null,
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
			// About one night in three runs late; the alarm doesn't move, so those nights are short.
			const late = random() < 0.32;
			const bed = late ? deadline + between(10, 75) : Math.max(0, deadline - between(0, 40));
			const wake = Math.min(2879, Math.max(bed + 300, 1440 + 390 + between(0, 40)));
			// Last night waits for its wake-up time ("How did you sleep?" in the morning).
			const open = !config.trackWake || ctx.date === addDays(ctx.today, -1);
			return [
				{
					id: trackerEntryKeyId(habit.id, "sleep", ctx.date),
					type: "sleep",
					data: {
						bed,
						wake: open ? null : wake,
						deadline,
						quality: open ? null : late ? between(2, 3) : between(3, 5),
					},
				},
			];
		}
		case "connection": {
			// Grandma's last call was a while ago, so the circle shows her as overdue.
			const recent = ctx.date > addDays(ctx.today, -OVERDUE_DAYS);
			const people = recent ? copy.people.filter((_, i) => i !== 2) : copy.people;
			return [
				{
					type: "connection",
					hour: between(12, 21),
					data: {
						person: pick(people),
						channel: pick(CHANNELS),
						minutes: between(5, 45),
						note: random() < 0.45 ? pick(copy.moments) : null,
						photos: [],
					},
				},
			];
		}
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
			return [{ type: "photo", hour: 13, data: { photos: [], caption: pick(copy.meals) } }];
		case "measure":
			if (config.aggregate === "last") {
				// A slow drift in the tracker's direction (one decimal).
				const step = config.direction === "down" ? -1 : 1;
				const value = Math.round((70 + step * random() * 3) * 10) / 10;
				return [{ type: "measure", hour: 7, data: { value, note: null } }];
			}
			return [{ type: "measure", hour: 8, data: { value: count, note: null } }];
		default:
			// plan: built with its tasks by `buildDemoTrackerEntries`.
			return [];
	}
}

/** Two books read one after the other; sessions fill the first, then the second. */
function shelf(
	start: DayKey,
	add: (date: DayKey, draft: Draft) => TrackerEntry,
	copy: (typeof COPY)[Locale],
) {
	// The whole reading list is on the shelf from the start: the first book in
	// progress, the rest up next. Each is finished on the day its last page is read.
	const books = copy.books.map((book, index) =>
		add(start, {
			type: "book",
			data: {
				title: book.title,
				author: book.author,
				pages: book.pages,
				startPage: 0,
				status: index === 0 ? "reading" : "next",
				finishedOn: null,
				rating: null,
				cover: null,
			},
		}),
	);
	let current = 0;
	let page = 0;
	let sessions = 0;
	return {
		/** Records a session of `pages`; its book, bookmark and (now and then) a line worth keeping. */
		sessionAt(
			pages: number,
			date: DayKey,
		): { bookId: string; toPage: number; quote: string | null } | null {
			const book = books[current];
			const meta = copy.books[current];
			if (!book || !meta) return null;
			page = Math.min(meta.pages, page + pages);
			sessions++;
			// A highlight on the 4th session of a book, then every 9th.
			const quotes: readonly string[] = meta.quotes;
			const slot =
				sessions === 4 ? 0 : sessions > 4 && (sessions - 4) % 9 === 0 ? (sessions - 4) / 9 : -1;
			const quote = slot >= 0 ? (quotes[slot] ?? null) : null;
			const session = { bookId: book.id, toPage: page, quote };
			if (page >= meta.pages) {
				book.data = {
					...book.data,
					status: "finished",
					finishedOn: date,
					rating: current % 2 === 0 ? 5 : 4,
				};
				current++;
				page = 0;
				sessions = 0;
				const next = books[current];
				if (next) next.data = { ...next.data, status: "reading" };
			}
			return session;
		},
	};
}
