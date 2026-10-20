import type { Translator } from "../../i18n";
import {
	currencyDecimals,
	currencySymbol,
	defaultCurrency,
	formatMoney,
	isCurrencyCode,
} from "../../money";
import type { ChoiceOption, FieldSpec } from "../forms";
import { TRACKER_META } from "../meta";
import { periodLength } from "../period";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, expenseTrackerSchema } from "../schema";
import type { SummaryBlock, SummaryContext } from "../summary";
import {
	barsChart,
	blocks,
	breakdown,
	compareToPrevious,
	daysOf,
	elapsedDays,
	inPeriod,
	latest,
	line,
	list,
	num,
	ofType,
	onDay,
	optionKey,
	previousEntries,
	recentTexts,
	stat,
	str,
	tally,
	tk,
} from "./kit";

type Config = Extract<TrackerConfig, { type: "expense" }>;

/** Built-in expense categories (Annex K §1.8.1), in composer order. */
export const EXPENSE_CATEGORIES = [
	{ id: "food", emoji: "🍽️" },
	{ id: "groceries", emoji: "🛒" },
	{ id: "transport", emoji: "🚌" },
	{ id: "home", emoji: "🏠" },
	{ id: "bills", emoji: "🧾" },
	{ id: "health", emoji: "💊" },
	{ id: "fun", emoji: "🎉" },
	{ id: "shopping", emoji: "🛍️" },
	{ id: "education", emoji: "📚" },
	{ id: "gifts", emoji: "🎁" },
	{ id: "subscriptions", emoji: "🔁" },
	{ id: "pets", emoji: "🐾" },
	{ id: "other", emoji: "✨" },
] as const;
export type ExpenseCategoryId = (typeof EXPENSE_CATEGORIES)[number]["id"];

/** A category's label and emoji: built-in, the tracker's own, or the raw id of a removed one. */
export function expenseCategory(
	id: string,
	config: Pick<Config, "categories">,
	t: Translator,
): { label: string; emoji: string } {
	const custom = config.categories.find((c) => c.id === id);
	if (custom) return { label: custom.label, emoji: custom.emoji };
	const builtIn = EXPENSE_CATEGORIES.find((c) => c.id === id);
	if (builtIn) return { label: tk(t, optionKey("category", builtIn.id)), emoji: builtIn.emoji };
	return { label: id, emoji: "🏷️" };
}

/** Composer chips: visible built-ins, then the tracker's own (a hidden current value stays). */
function categoryOptions(config: Config, t: Translator, current: string | null): ChoiceOption[] {
	const hidden = new Set(config.hidden);
	const options: ChoiceOption[] = [];
	for (const c of EXPENSE_CATEGORIES) {
		if (hidden.has(c.id) && c.id !== current) continue;
		options.push({ value: c.id, label: tk(t, optionKey("category", c.id)), emoji: c.emoji });
	}
	for (const c of config.categories) options.push({ value: c.id, label: c.label, emoji: c.emoji });
	if (current && !options.some((o) => o.value === current)) {
		options.push({ value: current, ...expenseCategory(current, config, t) });
	}
	return options;
}

const amountOf = (entry: TrackerEntry) => num(entry.data.amount) ?? 0;
const currencyOf = (entry: TrackerEntry, config: Config) => {
	const code = str(entry.data.currency);
	return code ?? config.currency;
};

/** Totals per currency, the tracker's own currency first. */
function totalsByCurrency(entries: readonly TrackerEntry[], config: Config): [string, number][] {
	const totals = new Map<string, number>();
	for (const entry of entries) {
		const code = currencyOf(entry, config);
		totals.set(code, (totals.get(code) ?? 0) + amountOf(entry));
	}
	return [...totals].sort(([a], [b]) =>
		a === config.currency ? -1 : b === config.currency ? 1 : a < b ? -1 : a > b ? 1 : 0,
	);
}

function moneyList(totals: readonly [string, number][], t: Translator): string {
	return totals.map(([code, minor]) => formatMoney(minor, code, t)).join(" + ");
}

/** This month's budget status ("R$ 320 left", "R$ 120 over budget"). */
function budgetLine(config: Config, spent: number, t: Translator, keys: "caption" | "headline") {
	if (config.budget === null) return null;
	const left = config.budget - spent;
	const amount = formatMoney(Math.abs(left), config.currency, t, { trim: true });
	if (keys === "headline") {
		return left >= 0
			? t.t("tracker.expense.headlineLeft", { amount })
			: t.t("tracker.expense.headlineOver", { amount });
	}
	return left >= 0
		? t.t("tracker.expense.budgetLeft", { amount })
		: t.t("tracker.expense.budgetOver", { amount });
}

function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { config, t, period } = ctx;
	const main = config.currency;
	const money = (minor: number, options?: { trim?: boolean }) =>
		formatMoney(minor, main, t, options);
	const expenses = inPeriod(ctx, "expense");
	const mine = expenses.filter((e) => currencyOf(e, config) === main);
	const others = expenses.filter((e) => currencyOf(e, config) !== main);
	const total = mine.reduce((acc, e) => acc + amountOf(e), 0);
	const elapsed = elapsedDays(ctx);
	const average = elapsed > 0 ? Math.round(total / elapsed) : 0;

	const previous = previousEntries(ctx).entries;
	const previousLogged = previous.some((e) => e.type === "expense" || e.type === "none");
	const previousTotal = ofType(previous, "expense")
		.filter((e) => currencyOf(e, config) === main)
		.reduce((acc, e) => acc + amountOf(e), 0);
	const delta = previousLogged ? compareToPrevious(ctx, total, previousTotal) : null;

	const spendDays = daysOf(expenses);
	const noSpendDays = [...daysOf(inPeriod(ctx, "none"))].filter((d) => !spendDays.has(d)).length;

	const stats: SummaryBlock = {
		kind: "stats",
		id: "stats",
		items: [
			stat("total", t.t("tracker.expense.total"), money(total), total, {
				...(delta ? { hint: delta.text, tone: delta.tone } : {}),
			}),
			stat("dailyAverage", t.t("tracker.expense.dailyAverage"), money(average), average),
			stat("count", t.t("tracker.expense.count"), t.number(expenses.length), expenses.length),
			stat("noSpendDays", t.t("tracker.expense.noSpendDays"), t.number(noSpendDays), noSpendDays),
		],
	};

	let progress: SummaryBlock | null = null;
	if (period.kind === "month" && config.budget !== null && config.budget > 0) {
		const days = periodLength(period);
		const running = ctx.today >= period.from && ctx.today < period.to;
		const pace = running && elapsed > 0 ? Math.round((total / elapsed) * days) : null;
		const caption = [
			budgetLine(config, total, t, "caption"),
			pace !== null ? t.t("tracker.expense.pace", { amount: money(pace, { trim: true }) }) : null,
		]
			.filter(Boolean)
			.join(" · ");
		progress = {
			kind: "progress",
			id: "budget",
			title: t.t("tracker.expense.budget"),
			value: total,
			max: config.budget,
			formatted: t.t("tracker.expense.budgetOf", {
				spent: money(total),
				budget: money(config.budget, { trim: true }),
			}),
			caption,
			tone:
				total > config.budget
					? "danger"
					: pace !== null && pace > config.budget
						? "warning"
						: "good",
		};
	}

	const categories = tally(mine, (e) => str(e.data.category) ?? "other", amountOf);
	const largest = [...mine]
		.sort((a, b) => amountOf(b) - amountOf(a) || (a.id < b.id ? -1 : 1))
		.slice(0, 5)
		.map((e) => {
			const category = expenseCategory(str(e.data.category) ?? "other", config, t);
			return {
				id: e.id,
				entryId: e.id,
				primary: str(e.data.note) ?? category.label,
				secondary: `${category.emoji} ${category.label} · ${t.formatDayShort(e.date)}`,
				trailing: money(amountOf(e)),
			};
		});
	const otherTotals = totalsByCurrency(others, config);

	return blocks(
		stats,
		progress,
		barsChart(ctx, mine, amountOf, {
			id: "spending",
			title: t.t(period.kind === "year" ? "tracker.expense.monthly" : "tracker.expense.daily"),
			format: "money",
			currency: main,
		}),
		breakdown(
			"categories",
			t.t("tracker.expense.byCategory"),
			[...categories].map(([id, value]) => ({ key: id, value, ...expenseCategory(id, config, t) })),
			(value) => money(value),
		),
		list("largest", t.t("tracker.expense.largest"), largest),
		otherTotals.length > 0 && {
			kind: "note",
			id: "otherCurrencies",
			tone: "default",
			text: t.t("tracker.expense.otherCurrencies", {
				list: otherTotals.map(([code, minor]) => formatMoney(minor, code, t)).join(" · "),
			}),
		},
	);
}

export const expenseDef: TrackerDef<Config> = {
	...TRACKER_META.expense,
	emoji: "🧾",
	primaryType: "expense",
	defaults: (ctx) =>
		expenseTrackerSchema.parse({
			type: "expense",
			currency: defaultCurrency(ctx.locale, ctx.region),
		}) as Config,

	form(type, ctx) {
		const { config, t } = ctx;
		if (type === "none") {
			return [
				{
					key: "note",
					kind: "text",
					label: t.t("tracker.expense.noSpendNote"),
					section: "primary",
					required: false,
					max: 140,
				},
			];
		}
		if (type !== "expense") return [];
		const editing = ctx.entryId
			? (ctx.index.byHabit.get(ctx.habit.id) ?? []).find((e) => e.id === ctx.entryId)
			: undefined;
		const code = editing ? currencyOf(editing, config) : config.currency;
		const currency = isCurrencyCode(code) || /^[A-Z]{3}$/.test(code) ? code : config.currency;
		const current = editing ? str(editing.data.category) : null;
		const history = ofType(ctx.index.byHabit.get(ctx.habit.id) ?? [], "expense");
		const specs: FieldSpec[] = [
			{
				key: "amount",
				kind: "money",
				label: t.t("tracker.expense.amount"),
				section: "primary",
				required: true,
				currency,
				symbol: currencySymbol(currency, t.locale),
				decimals: currencyDecimals(currency),
				hero: true,
			},
			{
				key: "category",
				kind: "choice",
				label: t.t("tracker.expense.category"),
				section: "primary",
				required: true,
				layout: "grid",
				options: categoryOptions(config, t, current),
			},
			{
				key: "note",
				kind: "text",
				label: t.t("tracker.expense.note"),
				section: "primary",
				required: false,
				max: 140,
				placeholder: t.t("tracker.expense.notePlaceholder"),
				suggestions: recentTexts(history, "note"),
			},
		];
		if (ctx.caps.photos) {
			specs.push({
				key: "photos",
				kind: "photos",
				label: t.t("tracker.expense.receipt"),
				section: "more",
				required: false,
				max: 2,
			});
		}
		return specs;
	},

	draft(type, ctx) {
		if (type !== "expense") return {};
		const history = ofType(ctx.index.byHabit.get(ctx.habit.id) ?? [], "expense");
		const hidden = new Set(ctx.config.hidden);
		const last = str(latest(history, "category"));
		const first = EXPENSE_CATEGORIES.find((c) => !hidden.has(c.id))?.id ?? "other";
		return { currency: ctx.config.currency, category: last ?? first };
	},

	dayLine({ config, entries, day, today, t }) {
		const expenses = ofType(entries, "expense");
		if (!expenses.length) {
			return ofType(entries, "none").length
				? onDay(t, day, today, "tracker.expense.noSpend", "tracker.expense.noSpendDay")
				: null;
		}
		const amount = moneyList(totalsByCurrency(expenses, config), t);
		const spent = onDay(t, day, today, "tracker.expense.today", "tracker.expense.onDay", {
			amount,
		});
		return `${spent} · ${t.tp("tracker.expense.items", expenses.length)}`;
	},

	entryLine(entry, { config, t }) {
		if (entry.type === "none") {
			return line(t.t("tracker.expense.noSpendEntry"), str(entry.data.note), entry);
		}
		const category = expenseCategory(str(entry.data.category) ?? "other", config, t);
		const note = str(entry.data.note);
		return line(
			formatMoney(amountOf(entry), currencyOf(entry, config), t),
			`${category.emoji} ${category.label}${note ? ` · ${note}` : ""}`,
			entry,
		);
	},

	summary,

	headline(ctx) {
		const { config, t } = ctx;
		const spent = inPeriod(ctx, "expense")
			.filter((e) => currencyOf(e, config) === config.currency)
			.reduce((acc, e) => acc + amountOf(e), 0);
		const budget =
			config.budget !== null && config.budget > 0 ? budgetLine(config, spent, t, "headline") : null;
		if (budget) return budget;
		if (spent <= 0) return null;
		return t.t("tracker.expense.headlineMonth", {
			amount: formatMoney(spent, config.currency, t, { trim: true }),
		});
	},
};
