import { identityTemplates } from "./content";
import { type DayKey, addDays, weekdayOf } from "./dates";
import { type Locale, resolveLocale } from "./i18n";
import {
	type AtomicData,
	type Habit,
	type HabitLog,
	type Identity,
	type LocaleSetting,
	type ScorecardItem,
	type Task,
	emptyData,
	habitSchema,
	logId,
} from "./model";

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
}

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
];

export function buildDemoData({
	today,
	now,
	locale,
}: {
	today: DayKey;
	now: number;
	locale: Locale | LocaleSetting | string;
}): AtomicData {
	const resolved: Locale =
		locale === "en" || locale === "pt-BR" ? locale : resolveLocale("system", [String(locale)]);
	const templates = identityTemplates(resolved);
	const random = mulberry32(20_241_017);
	const data = emptyData();
	const createdAt = now - HISTORY_DAYS * 86_400_000;

	const identityIds = new Map<string, string>();
	const usedIdentities = ["reader", "athlete", "mindful", "healthy", "present"];
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
			createdAt,
			updatedAt: createdAt,
			deletedAt: null,
		};
		data.identities[id] = identity;
		identityIds.set(key, id);
	});

	PLANS.forEach((plan, order) => {
		const identity = templates.find((t) => t.key === plan.identity);
		const template = identity?.habits.find((h) => h.key === plan.template);
		if (!identity || !template) return;
		const id = `demo-habit-${plan.template}`;
		const startDate = addDays(today, -plan.startOffset);
		const habit: Habit = habitSchema.parse({
			...template,
			id,
			identityId: identityIds.get(plan.identity) ?? null,
			reminder: false,
			startDate,
			order,
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
		if (plan.today) writeLog(today, Math.min(plan.today, habit.target));
	});

	const notes =
		resolved === "pt-BR"
			? ["Li no parque, foi ótimo.", "Difícil começar, mas fiz a versão de 2 minutos."]
			: ["Read in the park — lovely.", "Hard to start, did the two-minute version."];
	const readLog = data.logs[logId("demo-habit-read", addDays(today, -2))];
	if (readLog) readLog.note = notes[0] ?? null;
	const journalLog = data.logs[logId("demo-habit-journal", addDays(today, -5))];
	if (journalLog) journalLog.note = notes[1] ?? null;

	const pt = resolved === "pt-BR";
	const tasks: Array<Pick<Task, "title" | "date" | "priority"> & { done?: boolean }> = [
		{ title: pt ? "Renovar a academia" : "Renew gym membership", date: today, priority: 2 },
		{
			title: pt ? "Comprar um marcador de páginas" : "Buy a bookmark",
			date: today,
			priority: 0,
			done: true,
		},
		{ title: pt ? "Preparar a mochila de treino" : "Pack the gym bag", date: today, priority: 1 },
		{
			title: pt ? "Ligar para o dentista" : "Call the dentist",
			date: addDays(today, -1),
			priority: 3,
		},
		{ title: pt ? "Planejar a semana" : "Plan the week", date: addDays(today, 1), priority: 1 },
		{
			title: pt ? "Escolher o próximo livro" : "Pick the next book",
			date: addDays(today, 4),
			priority: 0,
		},
		{ title: pt ? "Pesquisar aulas de violão" : "Look up guitar lessons", date: null, priority: 0 },
	];
	tasks.forEach((task, order) => {
		const id = `demo-task-${order}`;
		data.tasks[id] = {
			id,
			title: task.title,
			notes: null,
			date: task.date,
			priority: task.priority,
			completedAt: task.done ? now - 3_600_000 : null,
			identityId: null,
			order,
			createdAt: now - (order + 1) * 3_600_000,
			updatedAt: now - (order + 1) * 3_600_000,
			deletedAt: null,
		};
	});

	const scorecard: Array<Pick<ScorecardItem, "label" | "rating" | "time">> = pt
		? [
				{ label: "Acordar", rating: "neutral", time: "06:30" },
				{ label: "Olhar o celular na cama", rating: "negative", time: "06:35" },
				{ label: "Passar o café", rating: "neutral", time: "06:45" },
				{ label: "Meditar 5 minutos", rating: "positive", time: "06:55" },
				{ label: "Ir de bicicleta para o trabalho", rating: "positive", time: "08:00" },
				{ label: "Lanchar doce à tarde", rating: "negative", time: "16:00" },
				{ label: "Ler antes de dormir", rating: "positive", time: "21:30" },
			]
		: [
				{ label: "Wake up", rating: "neutral", time: "06:30" },
				{ label: "Check phone in bed", rating: "negative", time: "06:35" },
				{ label: "Make coffee", rating: "neutral", time: "06:45" },
				{ label: "Meditate for 5 minutes", rating: "positive", time: "06:55" },
				{ label: "Bike to work", rating: "positive", time: "08:00" },
				{ label: "Afternoon sugary snack", rating: "negative", time: "16:00" },
				{ label: "Read before bed", rating: "positive", time: "21:30" },
			];
	scorecard.forEach((item, order) => {
		const id = `demo-score-${order}`;
		data.scorecard[id] = {
			id,
			...item,
			order,
			createdAt,
			updatedAt: createdAt,
			deletedAt: null,
		};
	});

	return data;
}
