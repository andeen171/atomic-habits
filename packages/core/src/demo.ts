import { type HabitTemplate, autoHabitEmoji, identityTemplates } from "./content";
import { type DayKey, type Weekday, addDays, eachDay, startOfWeek, weekdayOf } from "./dates";
import { FEATURES } from "./flags";
import { type Locale, resolveLocale } from "./i18n";
import {
	type AtomicData,
	type Habit,
	type HabitLog,
	type Identity,
	type JournalEntry,
	type LocaleSetting,
	type RepeatRule,
	type ScorecardItem,
	type Task,
	type TaskLaw,
	type TaskLog,
	type TaskLogStatus,
	emptyData,
	habitSchema,
	logId,
	repeatRuleSchema,
	taskLogId,
} from "./model";
import { addMonthKey, currentMonthKey, monthBounds } from "./month";
import { occurrencesBetween } from "./recurrence";
import { buildDemoTrackerEntries, demoTrackerPhrasePairs } from "./trackers/demo";

/** Small deterministic PRNG so sample data looks the same on every load. */
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

const HISTORY_DAYS = 120;

interface DemoHabitPlan {
	template: string;
	identity: string;
	startOffset: number;
	/** Completion probability at the start and end of the history. */
	from: number;
	to: number;
	/** Days before today that must be done / missed (to shape streaks). */
	forceDone?: number;
	missRecent?: number[];
	today?: number;
	/**
	 * Annex H §9.13: last month beats the target on 80% of its days (target
	 * + 1…4, the rest exactly on target), so the demo shows a level-up card.
	 */
	overshoot?: boolean;
	/** A demo-only habit (no template with this key). */
	custom?: (locale: Locale) => HabitTemplate;
}

const DAY_MS = 86_400_000;

const PLANS: DemoHabitPlan[] = [
	{
		template: "meditate",
		identity: "mindful",
		startOffset: 120,
		from: 0.55,
		to: 0.92,
		forceDone: 0,
		missRecent: [1],
		today: 0,
	},
	{
		template: "read",
		identity: "reader",
		startOffset: 120,
		from: 0.5,
		to: 0.95,
		forceDone: 18,
		today: 0,
		overshoot: true,
	},
	{
		template: "water",
		identity: "healthy",
		startOffset: 95,
		from: 0.45,
		to: 0.85,
		forceDone: 6,
		today: 3,
	},
	{ template: "workout", identity: "athlete", startOffset: 120, from: 0.3, to: 0.6, today: 1 },
	{
		template: "journal",
		identity: "mindful",
		startOffset: 45,
		from: 0.6,
		to: 0.85,
		forceDone: 9,
		today: 0,
	},
	{ template: "doomscroll", identity: "present", startOffset: 80, from: 0.3, to: 0.04 },
	// Appended last so the habits above keep their random history.
	{ template: "expenses", identity: "saver", startOffset: 60, from: 0.55, to: 0.9, forceDone: 2 },
];

/** "Do push-ups": a number log (milestone 4B), summed per day. */
function pushUps(locale: Locale): HabitTemplate {
	const pt = locale === "pt-BR";
	const unit = pt ? "flexões" : "push-ups";
	return {
		key: "pushUps",
		name: pt ? "Fazer flexões" : "Do push-ups",
		emoji: "💪",
		color: "ember",
		kind: "build",
		target: 20,
		unit,
		schedule: { type: "daily" },
		timeOfDay: "morning",
		cueTime: null,
		cueLocation: null,
		stackAfter: pt ? "escovar os dentes" : "brush my teeth",
		twoMinute: pt ? "Fazer uma flexão" : "Do one push-up",
		bundle: null,
		reward: null,
		environment: null,
		tracker: { type: "measure", unit, aggregate: "sum", decimals: 0, direction: "up" },
		requires: "trackerPhaseB",
	};
}

/**
 * Habits of the later tracker milestones, appended while their flags are on
 * (after every other habit, so the ones above keep their random history and
 * the demo with the flags off doesn't change).
 */
function flaggedPlans(): DemoHabitPlan[] {
	const plans: DemoHabitPlan[] = [];
	if (FEATURES.trackerPhaseB) {
		plans.push(
			{
				template: "plan",
				identity: "organized",
				startOffset: 28,
				from: 0.6,
				to: 0.9,
				forceDone: 3,
			},
			{
				template: "pushUps",
				identity: "athlete",
				startOffset: 40,
				from: 0.4,
				to: 0.8,
				custom: pushUps,
			},
		);
	}
	if (FEATURES.trackerPhotos) {
		plans.push({
			template: "vegetables",
			identity: "healthy",
			startOffset: 30,
			from: 0.5,
			to: 0.85,
			forceDone: 2,
		});
	}
	if (FEATURES.templateTrackers) {
		// Present and healthy get a tracker habit too: the circle (one person overdue) and bedtimes.
		plans.push(
			{ template: "call", identity: "present", startOffset: 70, from: 0.3, to: 0.45, forceDone: 1 },
			{
				template: "sleep",
				identity: "healthy",
				startOffset: 45,
				from: 0.75,
				to: 0.9,
				forceDone: 1,
			},
		);
	}
	return plans;
}

/**
 * Sample data for "Explore with sample data" (spec §3.1 `demo.ts`, D39): six
 * identities with habits and history, the saver identity with "Log
 * expenses", one-off tasks plus recurring and setup tasks with their logs
 * (Annex T §3.6), nine journal entries (Annex J §2.6), the scorecard, a read
 * habit whose last month earns a level-up card, and, while the tracker flags
 * are on, tracker entries whose logs already match them (zero reconcile
 * writes). Deterministic for a given `today`, `now` and locale.
 */
export function buildDemoData({
	today,
	now,
	locale,
	weekStartsOn = 1,
}: {
	today: DayKey;
	now: number;
	locale: Locale | LocaleSetting | string;
	/** The device's week start: the weekly rules' frozen `weekStart` and the review's week. */
	weekStartsOn?: Weekday;
}): AtomicData {
	const resolved: Locale =
		locale === "en" || locale === "pt-BR" ? locale : resolveLocale("system", [String(locale)]);
	const templates = identityTemplates(resolved);
	const random = mulberry32(20_241_017);
	const data = emptyData();
	const createdAt = now - HISTORY_DAYS * DAY_MS;

	const identityIds = new Map<string, string>();
	const usedIdentities = ["reader", "athlete", "mindful", "healthy", "present", "saver"];
	if (FEATURES.trackerPhaseB) usedIdentities.push("organized");
	usedIdentities.forEach((key, order) => {
		const template = templates.find((t) => t.key === key);
		if (!template) return;
		const id = `demo-identity-${key}`;
		const identity: Identity = {
			id,
			statement: template.statement,
			emoji: template.emoji,
			color: template.color,
			order,
			lang: resolved,
			createdAt,
			updatedAt: createdAt,
			deletedAt: null,
		};
		data.identities[id] = identity;
		identityIds.set(key, id);
	});

	[...PLANS, ...flaggedPlans()].forEach((plan, order) => {
		const identity = templates.find((t) => t.key === plan.identity);
		const template = plan.custom
			? plan.custom(resolved)
			: identity?.habits.find((h) => h.key === plan.template);
		if (!identity || !template) return;
		const id = `demo-habit-${plan.template}`;
		const startDate = addDays(today, -plan.startOffset);
		const habit: Habit = habitSchema.parse({
			...template,
			// D12: the identity's icon wins; the template's own emoji is only the editor's "Use 📖" chip.
			emoji: autoHabitEmoji(template.kind, identity.emoji),
			emojiAuto: true,
			id,
			identityId: identityIds.get(plan.identity) ?? null,
			reminder: false,
			startDate,
			order,
			lang: resolved,
			createdAt,
			updatedAt: createdAt,
			deletedAt: null,
		});
		data.habits[id] = habit;

		const writeLog = (date: DayKey, count: number, note: string | null = null) => {
			const log: HabitLog = {
				id: logId(id, date),
				habitId: id,
				date,
				count,
				skipped: false,
				note,
				createdAt,
				updatedAt: createdAt,
				deletedAt: null,
			};
			data.logs[log.id] = log;
		};

		for (let offset = plan.startOffset; offset >= 1; offset--) {
			const date = addDays(today, -offset);
			const progress = 1 - offset / plan.startOffset;
			const p = plan.from + (plan.to - plan.from) * progress;
			if (habit.kind === "break") {
				if (offset <= 23) continue; // a clean streak to admire
				if (random() < p) writeLog(date, 1);
				continue;
			}
			if (habit.schedule.type === "weekdays" && !habit.schedule.days.includes(weekdayOf(date))) {
				continue;
			}
			if (plan.missRecent?.includes(offset)) continue;
			const forced = plan.forceDone != null && offset <= plan.forceDone;
			const chance = habit.schedule.type === "weekly" ? p * 0.75 : p;
			if (forced || random() < chance) {
				writeLog(date, habit.target);
			} else if (habit.target > 1 && random() < 0.5) {
				writeLog(date, Math.max(1, Math.floor(random() * habit.target)));
			}
		}
		if (plan.overshoot) {
			// Its own PRNG, so the other habits keep their history.
			const extra = mulberry32(20_261_001);
			const evidence = addMonthKey(currentMonthKey(habit, today, weekStartsOn), -1);
			const { first, last } = monthBounds(evidence);
			eachDay(first < startDate ? startDate : first, last).forEach((date, i) => {
				writeLog(date, i % 5 === 2 ? habit.target : habit.target + 1 + Math.floor(extra() * 4));
			});
		}
		if (plan.today) writeLog(today, Math.min(plan.today, habit.target));
	});

	// With template trackers on, tracker habits get entries and their logs follow
	// them (`dayCountFor`), so the demo loads without reconcile writes.
	if (FEATURES.templateTrackers || FEATURES.trackerPhaseB || FEATURES.trackerPhotos) {
		const tracked = buildDemoTrackerEntries({ data, today, locale: resolved, createdAt, now });
		Object.assign(data.trackerEntries, tracked.trackerEntries);
		Object.assign(data.logs, tracked.logs);
		Object.assign(data.tasks, tracked.tasks);
		Object.assign(data.habits, tracked.habits);
	}

	const notes =
		resolved === "pt-BR"
			? ["Li no parque, foi ótimo.", "Difícil começar, mas fiz a versão de 2 minutos."]
			: ["Read in the park — lovely.", "Hard to start, did the two-minute version."];
	const readLog = data.logs[logId("demo-habit-read", addDays(today, -2))];
	if (readLog) readLog.note = notes[0] ?? null;
	const journalLog = data.logs[logId("demo-habit-journal", addDays(today, -5))];
	if (journalLog) journalLog.note = notes[1] ?? null;

	const weekStart: 0 | 1 = weekStartsOn === 0 ? 0 : 1;
	const taskTitle = (key: keyof typeof DEMO_TASK_TITLES) => DEMO_TASK_TITLES[key][resolved];
	const tasks: DemoTask[] = [
		{ title: taskTitle("gym"), date: today, priority: 2 },
		{
			title: taskTitle("bookmark"),
			date: today,
			priority: 0,
			completedAt: now - 3_600_000,
		},
		// Annex T §3.6: a setup task for the workout's environment, Mon/Wed/Fri.
		{
			title: taskTitle("gymBag"),
			date: addDays(today, -28),
			priority: 1,
			repeat: series({ type: "weeks", every: 1, days: [1, 3, 5], weekStart }),
			link: { habit: "workout", law: 1, field: "environment" },
			settle: (_date, i) => (i === 4 ? "skipped" : "done"),
		},
		{
			title: taskTitle("dentist"),
			date: addDays(today, -1),
			priority: 3,
		},
		{ title: taskTitle("planWeek"), date: addDays(today, 1), priority: 1 },
		{
			title: taskTitle("nextBook"),
			date: addDays(today, 4),
			priority: 0,
		},
		{ title: taskTitle("guitar"), date: null, priority: 0 },
		// Every 3 days: one skip, one late, and the last one missed, so today's
		// row reads "1 missed".
		{
			title: taskTitle("plants"),
			date: addDays(today, -30),
			priority: 0,
			repeat: series({ type: "days", every: 3 }),
			settle: (date, i) => (date >= addDays(today, -3) ? null : i === 5 ? "skipped" : "done"),
			lateBy: (_date, i) => (i === 6 ? 1 : 0),
		},
		{
			title: taskTitle("review"),
			date: addDays(today, -56),
			priority: 1,
			repeat: series({ type: "weeks", every: 1, days: [0], weekStart }),
		},
		// A one-off setup task for the doomscrolling habit's environment, done.
		{
			title: taskTitle("charge"),
			date: addDays(today, -20),
			priority: 0,
			completedAt: now - 20 * DAY_MS,
			link: { habit: "doomscroll", law: 1, field: "environment" },
		},
	];
	tasks.forEach((task, order) => {
		const id = `demo-task-${order}`;
		const habitId = task.link ? `demo-habit-${task.link.habit}` : null;
		// Series and setup tasks predate their history; one-offs were added today.
		const at = task.repeat || task.link ? createdAt : now - (order + 1) * 3_600_000;
		data.tasks[id] = {
			id,
			title: task.title,
			notes: null,
			date: task.date,
			priority: task.priority,
			completedAt: task.completedAt ?? null,
			identityId: (habitId && data.habits[habitId]?.identityId) || null,
			order,
			repeat: task.repeat ?? null,
			time: null,
			habitId: habitId && data.habits[habitId] ? habitId : null,
			law: task.link?.law ?? null,
			habitField: task.link?.field ?? null,
			sourceEntryId: null,
			lang: resolved,
			createdAt: at,
			updatedAt: at,
			deletedAt: null,
		};
		const rule = task.repeat;
		if (!rule || rule.type === "after" || !task.date) return;
		// Settle every occurrence before today (done unless `settle` says otherwise).
		occurrencesBetween(rule, task.date, task.date, addDays(today, -1)).forEach((date, i) => {
			const status = task.settle ? task.settle(date, i) : "done";
			if (!status) return;
			const log: TaskLog = {
				id: taskLogId(id, date),
				taskId: id,
				date,
				status,
				resolvedOn: addDays(date, task.lateBy?.(date, i) ?? 0),
				createdAt,
				updatedAt: createdAt,
				deletedAt: null,
			};
			data.taskLogs[log.id] = log;
		});
	});

	buildDemoJournal(data, { today, now, createdAt, locale: resolved, weekStartsOn });

	const scorecard = DEMO_SCORECARD[resolved];
	scorecard.forEach((item, order) => {
		const id = `demo-score-${order}`;
		data.scorecard[id] = {
			id,
			...item,
			order,
			lang: resolved,
			createdAt,
			updatedAt: createdAt,
			deletedAt: null,
		};
	});

	return data;
}

/** Demo task titles; `demoPhrasePairs` hands them to the phrasebook. */
const DEMO_TASK_TITLES = {
	gym: { en: "Renew gym membership", "pt-BR": "Renovar a academia" },
	bookmark: { en: "Buy a bookmark", "pt-BR": "Comprar um marcador de páginas" },
	gymBag: { en: "Pack the gym bag", "pt-BR": "Preparar a mochila de treino" },
	dentist: { en: "Call the dentist", "pt-BR": "Ligar para o dentista" },
	planWeek: { en: "Plan the week", "pt-BR": "Planejar a semana" },
	nextBook: { en: "Pick the next book", "pt-BR": "Escolher o próximo livro" },
	guitar: { en: "Look up guitar lessons", "pt-BR": "Pesquisar aulas de violão" },
	plants: { en: "Water the plants", "pt-BR": "Regar as plantas" },
	review: { en: "Weekly review", "pt-BR": "Revisão semanal" },
	charge: {
		en: "Charge the phone outside the bedroom",
		"pt-BR": "Carregar o celular fora do quarto",
	},
} as const satisfies Record<string, Record<Locale, string>>;

/** The Habits Scorecard (same rows, in the same order, in both languages). */
const DEMO_SCORECARD: Record<Locale, Array<Pick<ScorecardItem, "label" | "rating" | "time">>> = {
	en: [
		{ label: "Wake up", rating: "neutral", time: "06:30" },
		{ label: "Check phone in bed", rating: "negative", time: "06:35" },
		{ label: "Make coffee", rating: "neutral", time: "06:45" },
		{ label: "Meditate for 5 minutes", rating: "positive", time: "06:55" },
		{ label: "Bike to work", rating: "positive", time: "08:00" },
		{ label: "Afternoon sugary snack", rating: "negative", time: "16:00" },
		{ label: "Read before bed", rating: "positive", time: "21:30" },
	],
	"pt-BR": [
		{ label: "Acordar", rating: "neutral", time: "06:30" },
		{ label: "Olhar o celular na cama", rating: "negative", time: "06:35" },
		{ label: "Passar o café", rating: "neutral", time: "06:45" },
		{ label: "Meditar 5 minutos", rating: "positive", time: "06:55" },
		{ label: "Ir de bicicleta para o trabalho", rating: "positive", time: "08:00" },
		{ label: "Lanchar doce à tarde", rating: "negative", time: "16:00" },
		{ label: "Ler antes de dormir", rating: "positive", time: "21:30" },
	],
};

/**
 * The demo's own translatable text that isn't template text, as `[en,
 * pt-BR]` pairs: the push-ups habit, task titles (plan lines included) and
 * scorecard labels. The phrasebook adds them, so sample data loaded in one
 * language reads in the other after a switch (no English names in the
 * Portuguese UI). Journal and tracker entry text is never translated.
 */
export function demoPhrasePairs(): Array<readonly [en: string, ptBR: string]> {
	const pairs: Array<readonly [string, string]> = [];
	const add = (en: string | null | undefined, pt: string | null | undefined) => {
		if (en && pt) pairs.push([en, pt]);
	};
	const en = pushUps("en");
	const pt = pushUps("pt-BR");
	for (const field of ["name", "unit", "stackAfter", "twoMinute"] as const)
		add(en[field], pt[field]);
	for (const title of Object.values(DEMO_TASK_TITLES)) add(title.en, title["pt-BR"]);
	DEMO_SCORECARD.en.forEach((item, i) => add(item.label, DEMO_SCORECARD["pt-BR"][i]?.label));
	for (const [a, b] of demoTrackerPhrasePairs()) add(a, b);
	return pairs;
}

interface DemoTask extends Pick<Task, "title" | "date" | "priority"> {
	completedAt?: number;
	repeat?: RepeatRule;
	/** A setup task: the demo habit (template key) it helps form. */
	link?: { habit: string; law: TaskLaw; field: string | null };
	/** Series: how the i-th occurrence before today was settled (null: left open). Default done. */
	settle?: (date: DayKey, i: number) => TaskLogStatus | null;
	/** Series: days late the i-th occurrence was settled. */
	lateBy?: (date: DayKey, i: number) => number;
}

/** A repeat rule with its defaults filled in (`until`, `count`, `endedAt`…). */
function series(rule: Record<string, unknown>): RepeatRule {
	return repeatRuleSchema.parse(rule);
}

/** Journal copy (Annex J §2.6), one entry per field of each kind. */
const JOURNAL_COPY = {
	en: {
		evidenceReader: "Read 20 pages at the park instead of scrolling.",
		evidenceMindful: "Meditated before checking my phone five mornings in a row.",
		obstacle: "Overslept and rushed out.",
		where: "on the living room couch",
		twoMinute: "Take ten slow breaths",
		adjust: "Keep 10 pages; add a second book for weekends.",
		commitment: "I will work out, 3 times a week.",
		consequence: "pay Ana $20 for every missed week",
		behavior: "Opened Instagram while waiting for coffee",
		say: "If I keep doing this, I'll never be bored long enough to think.",
		well: "Read every day and finished a book.",
		notWell: "Skipped two workouts when work got busy.",
		learned: "Packing the gym bag the night before makes mornings easy.",
		next: "Pack the gym bag on Sunday night",
		values: "Curiosity, health, presence with my family.",
		living: "Mostly: mornings are calm, but evenings still go to the phone.",
		standard: "Phone out of the bedroom, every night.",
		oldStory: "I don't have time to cook.",
		proof: "Cook dinner twice this week.",
	},
	"pt-BR": {
		evidenceReader: "Li 20 páginas no parque em vez de rolar o feed.",
		evidenceMindful: "Meditei antes de olhar o celular cinco manhãs seguidas.",
		obstacle: "Perdi a hora e saí correndo.",
		where: "no sofá da sala",
		twoMinute: "Respirar fundo dez vezes",
		adjust: "Manter 10 páginas; incluir um segundo livro para os fins de semana.",
		commitment: "Vou treinar, 3 vezes por semana.",
		consequence: "pagar R$ 50 à Ana por semana perdida",
		behavior: "Abri o Instagram enquanto esperava o café",
		say: "Se eu continuar assim, nunca vou ficar entediado o bastante para pensar.",
		well: "Li todos os dias e terminei um livro.",
		notWell: "Pulei dois treinos quando o trabalho apertou.",
		learned: "Deixar a mochila de treino pronta na noite anterior facilita as manhãs.",
		next: "Preparar a mochila de treino no domingo à noite",
		values: "Curiosidade, saúde, presença com minha família.",
		living: "Em boa parte: as manhãs são calmas, mas as noites ainda vão para o celular.",
		standard: "Celular fora do quarto, todas as noites.",
		oldStory: "Não tenho tempo para cozinhar.",
		proof: "Cozinhar o jantar duas vezes esta semana.",
	},
} as const;

/**
 * The nine journal entries of Annex J §2.6 (`demo-journal-<n>`). The recovery
 * plan is for meditate's miss yesterday (`missRecent: [1]`), so the Never
 * miss twice banner shows it.
 */
function buildDemoJournal(
	data: AtomicData,
	ctx: { today: DayKey; now: number; createdAt: number; locale: Locale; weekStartsOn: Weekday },
) {
	const { today, now, createdAt, locale, weekStartsOn } = ctx;
	const copy = JOURNAL_COPY[locale];
	const identity = (key: string) => {
		const id = `demo-identity-${key}`;
		return data.identities[id] ? id : null;
	};
	const habit = (key: string) => {
		const id = `demo-habit-${key}`;
		return data.habits[id] ? id : null;
	};
	const reviewFrom = addDays(startOfWeek(today, weekStartsOn), -7);
	const reviewTo = addDays(reviewFrom, 6);
	const year = Number(today.slice(0, 4));
	const integrityDay = today > `${year}-06-20` ? `${year}-06-20` : `${year - 1}-06-20`;
	const healthy = data.identities["demo-identity-healthy"];
	const entries: Array<Partial<JournalEntry> & Pick<JournalEntry, "kind" | "date">> = [
		{
			kind: "evidence",
			date: addDays(today, -2),
			identityId: identity("reader"),
			answers: { text: copy.evidenceReader },
		},
		{
			kind: "evidence",
			date: addDays(today, -6),
			identityId: identity("mindful"),
			answers: { text: copy.evidenceMindful },
		},
		{
			kind: "recovery",
			date: addDays(today, -1),
			identityId: identity("mindful"),
			habitId: habit("meditate"),
			answers: {
				obstacle: copy.obstacle,
				when: "07:00",
				where: copy.where,
				twoMinute: copy.twoMinute,
			},
		},
		{
			kind: "checkin",
			date: addDays(today, -10),
			identityId: identity("reader"),
			habitId: habit("read"),
			difficulty: "just-right",
			answers: { adjust: copy.adjust },
		},
		{
			kind: "contract",
			date: addDays(today, -10),
			identityId: identity("athlete"),
			habitId: habit("workout"),
			answers: { commitment: copy.commitment, consequence: copy.consequence },
			contract: {
				until: addDays(today, 20),
				partner: "Ana",
				signedAt: now - 10 * DAY_MS,
				outcome: null,
			},
		},
		{
			kind: "awareness",
			date: addDays(today, -3),
			identityId: identity("present"),
			rating: "negative",
			answers: { behavior: copy.behavior, say: copy.say },
		},
		{
			kind: "review",
			date: addDays(reviewTo, 1),
			range: { from: reviewFrom, to: reviewTo },
			answers: {
				well: copy.well,
				notWell: copy.notWell,
				learned: copy.learned,
				next: copy.next,
			},
		},
		{
			kind: "integrity",
			date: integrityDay,
			pinned: true,
			answers: { values: copy.values, living: copy.living, standard: copy.standard },
		},
		{
			kind: "belief",
			date: addDays(today, -4),
			identityId: identity("healthy"),
			answers: {
				oldStory: copy.oldStory,
				newStory: healthy?.statement ?? "",
				proof: copy.proof,
			},
		},
	];
	entries.forEach((entry, i) => {
		const id = `demo-journal-${i + 1}`;
		data.journal[id] = {
			id,
			identityId: null,
			habitId: null,
			answers: {},
			rating: null,
			difficulty: null,
			range: null,
			contract: null,
			pinned: false,
			...entry,
			createdAt,
			updatedAt: createdAt,
			deletedAt: null,
		};
	});
}
