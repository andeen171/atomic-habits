import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	CURRENCIES,
	CURRENCY_CODES,
	EXPENSE_CATEGORIES,
	type TrackerConfig,
	WORKOUT_ACTIVITIES,
	currencyDecimals,
	currencySymbol,
	foldText,
	moneyInputValue,
	parseMoney,
} from "@atomic/core";
import { Plus, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { controlClass } from "../ui/control";
import { NumberField } from "../ui/number-field";
import { Switch } from "../ui/switch";
import { TimeField } from "../ui/time-field";
import { ToggleGroup } from "../ui/toggle-group";

/**
 * A tracker's settings, per type (Annex K §4.1 `tracker-settings.tsx`):
 * currency, budget and categories (expense); what to count (reading,
 * session, writing); the timer, prompt, bell and pinned topics (session);
 * target time and grace (wake, sleep); the circle (connection); the cost
 * (slip); and the 4B/4C options. Used inline by the editor's tracker picker
 * and by the Tracker settings dialog. Owner: T4.
 */
export interface TrackerSettingsFieldsProps {
	config: TrackerConfig;
	onChange(config: TrackerConfig): void;
}

export function TrackerSettingsFields({ config, onChange }: TrackerSettingsFieldsProps) {
	const set = (patch: Partial<TrackerConfig>) => onChange({ ...config, ...patch } as TrackerConfig);
	switch (config.type) {
		case "expense":
			return <ExpenseSettings config={config} set={set} />;
		case "reading":
			return <ReadingSettings config={config} set={set} />;
		case "workout":
			return <WorkoutSettings config={config} set={set} />;
		case "session":
			return <SessionSettings config={config} set={set} />;
		case "writing":
			return <WritingSettings config={config} set={set} />;
		case "wake":
			return <ClockSettings config={config} set={set} />;
		case "sleep":
			return <ClockSettings config={config} set={set} />;
		case "connection":
			return <ConnectionSettings config={config} set={set} />;
		case "slip":
			return <SlipSettings config={config} set={set} />;
		case "plan":
			return <PlanSettings config={config} set={set} />;
		case "measure":
			return <MeasureSettings config={config} set={set} />;
		case "photo":
			return <PhotoSettings config={config} set={set} />;
	}
}

type Of<T extends TrackerConfig["type"]> = Extract<TrackerConfig, { type: T }>;
interface SettingsProps<T extends TrackerConfig["type"]> {
	config: Of<T>;
	set(patch: Partial<Of<T>>): void;
}

// ── Layout helpers ────────────────────────────────────────────────────────

function Stack({ children }: { children: ReactNode }) {
	return <div className="flex flex-col gap-5">{children}</div>;
}

/** A labelled control with an optional hint; `htmlFor` ties the label to a single control. */
function Row({
	label,
	hint,
	htmlFor,
	children,
	className,
}: {
	label: string;
	hint?: string;
	htmlFor?: string;
	children: ReactNode;
	className?: string;
}) {
	const Label = htmlFor ? "label" : "span";
	return (
		<div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
			<Label
				htmlFor={htmlFor}
				aria-hidden={htmlFor ? undefined : true}
				className="font-medium text-ink text-small"
			>
				{label}
			</Label>
			{children}
			{hint ? <p className="text-ink-subtle text-small">{hint}</p> : null}
		</div>
	);
}

function SwitchRow({
	label,
	hint,
	checked,
	onChange,
}: {
	label: string;
	hint?: string;
	checked: boolean;
	onChange(checked: boolean): void;
}) {
	const id = useId();
	return (
		<div className="flex items-start justify-between gap-4">
			<div className="min-w-0">
				<label htmlFor={id} className="font-medium text-ink text-small">
					{label}
				</label>
				{hint ? <p className="text-ink-subtle text-small">{hint}</p> : null}
			</div>
			<Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
		</div>
	);
}

function Choice<T extends string>({
	label,
	hint,
	value,
	options,
	onChange,
}: {
	label: string;
	hint?: string;
	value: T;
	options: { value: T; label: string }[];
	onChange(value: T): void;
}) {
	return (
		<Row label={label} hint={hint}>
			<ToggleGroup<T>
				type="single"
				label={label}
				size="sm"
				value={value}
				onChange={(next) => next && onChange(next)}
				options={options}
			/>
		</Row>
	);
}

function CurrencySelect({ value, onChange }: { value: string; onChange(code: string): void }) {
	const { t } = useT();
	const id = useId();
	return (
		<Row label={t("tracker.settings.currency")} htmlFor={id}>
			<select
				id={id}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className={cn(controlClass, "h-11 pr-8")}
			>
				{CURRENCY_CODES.map((code) => (
					<option key={code} value={code}>
						{`${CURRENCIES[code].name[t.locale]} (${currencySymbol(code, t.locale)})`}
					</option>
				))}
				{(CURRENCY_CODES as readonly string[]).includes(value) ? null : (
					<option value={value}>{value}</option>
				)}
			</select>
		</Row>
	);
}

/** Editable chips (pinned topics, activities): remove with ×, add from a field. */
function ChipList({
	label,
	hint,
	items,
	max,
	maxLength,
	placeholder,
	onChange,
}: {
	label: string;
	hint?: string;
	items: readonly string[];
	max: number;
	maxLength: number;
	placeholder: string;
	onChange(items: string[]): void;
}) {
	const { t } = useT();
	const id = useId();
	const [draft, setDraft] = useState("");
	const add = () => {
		const value = draft.trim().slice(0, maxLength);
		if (!value || items.some((item) => item.toLowerCase() === value.toLowerCase())) {
			setDraft("");
			return;
		}
		onChange([...items, value].slice(0, max));
		setDraft("");
	};
	return (
		<Row label={label} hint={hint} htmlFor={id}>
			{items.length ? (
				<ul className="flex flex-wrap gap-1.5">
					{items.map((item) => (
						<li
							key={item}
							className="inline-flex h-8 items-center gap-1 rounded-full border border-line bg-surface pr-1 pl-3 text-ink text-small"
						>
							<span className="max-w-48 truncate">{item}</span>
							<button
								type="button"
								aria-label={t("tracker.settings.remove", { name: item })}
								onClick={() => onChange(items.filter((i) => i !== item))}
								className="grid size-6 place-items-center rounded-full text-ink-muted hover:bg-hover hover:text-ink"
							>
								<X className="size-3.5" aria-hidden="true" />
							</button>
						</li>
					))}
				</ul>
			) : null}
			{items.length < max ? (
				<div className="flex gap-2">
					<input
						id={id}
						type="text"
						value={draft}
						maxLength={maxLength}
						placeholder={placeholder}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								add();
							}
						}}
						className={cn(controlClass, "h-10 min-w-0 flex-1")}
					/>
					<button
						type="button"
						onClick={add}
						disabled={!draft.trim()}
						className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 font-medium text-ink text-small hover:bg-hover disabled:opacity-50"
					>
						<Plus className="size-4" aria-hidden="true" />
						{t("common.add")}
					</button>
				</div>
			) : null}
		</Row>
	);
}

// ── Expense ───────────────────────────────────────────────────────────────

function slugId(label: string, taken: readonly string[]): string {
	const base =
		foldText(label)
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 24) || "custom";
	let id = `c-${base}`;
	for (let n = 2; taken.includes(id); n++) id = `c-${base.slice(0, 22)}-${n}`;
	return id;
}

function ExpenseSettings({ config, set }: SettingsProps<"expense">) {
	const { t } = useT();
	const budgetId = useId();
	const [budgetText, setBudgetText] = useState(() =>
		moneyInputValue(config.budget, config.currency, t.locale),
	);
	const [emoji, setEmoji] = useState("");
	const [label, setLabel] = useState("");
	const labelId = useId();
	const visible = EXPENSE_CATEGORIES.map((c) => c.id).filter((id) => !config.hidden.includes(id));

	const commitBudget = (text: string, currency = config.currency) => {
		const minor = text.trim() ? parseMoney(text, t.locale, currencyDecimals(currency)) : null;
		set({ budget: minor });
		setBudgetText(moneyInputValue(minor, currency, t.locale));
	};

	const addCategory = () => {
		const name = label.trim().slice(0, 32);
		if (!name || config.categories.length >= 24) return;
		const id = slugId(
			name,
			config.categories.map((c) => c.id),
		);
		set({ categories: [...config.categories, { id, label: name, emoji: emoji.trim() || "🏷️" }] });
		setLabel("");
		setEmoji("");
	};

	return (
		<Stack>
			<CurrencySelect
				value={config.currency}
				onChange={(currency) => {
					set({ currency });
					setBudgetText(moneyInputValue(config.budget, currency, t.locale));
				}}
			/>
			<Row
				label={t("tracker.expense.budget")}
				hint={t("tracker.settings.budgetHint")}
				htmlFor={budgetId}
			>
				<div
					className={cn(
						controlClass,
						"flex h-11 items-center gap-2 focus-within:border-accent focus-within:bg-surface focus-within:ring-3 focus-within:ring-accent/15",
					)}
				>
					<span aria-hidden="true" className="shrink-0 text-ink-muted">
						{currencySymbol(config.currency, t.locale)}
					</span>
					<input
						id={budgetId}
						type="text"
						inputMode="decimal"
						autoComplete="off"
						value={budgetText}
						placeholder={moneyInputValue(0, config.currency, t.locale)}
						onChange={(event) => setBudgetText(event.target.value)}
						onBlur={() => commitBudget(budgetText)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								commitBudget(budgetText);
							}
						}}
						className="h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none"
					/>
				</div>
			</Row>
			<Row label={t("tracker.settings.categories")} hint={t("tracker.settings.categoriesHint")}>
				<ToggleGroup
					type="multiple"
					label={t("tracker.settings.categories")}
					size="sm"
					min={1}
					value={visible}
					onChange={(shown) =>
						set({
							hidden: EXPENSE_CATEGORIES.map((c) => c.id).filter((id) => !shown.includes(id)),
						})
					}
					options={EXPENSE_CATEGORIES.map((c) => ({
						value: c.id,
						label: (
							<>
								<span aria-hidden="true" className="font-emoji">
									{c.emoji}
								</span>
								{t(`tracker.category.${c.id === "other" ? "misc" : c.id}`)}
							</>
						),
					}))}
				/>
			</Row>
			<Row label={t("tracker.settings.addCategory")} htmlFor={labelId}>
				{config.categories.length ? (
					<ul className="flex flex-wrap gap-1.5">
						{config.categories.map((c) => (
							<li
								key={c.id}
								className="inline-flex h-8 items-center gap-1 rounded-full border border-line bg-surface pr-1 pl-3 text-ink text-small"
							>
								<span aria-hidden="true" className="font-emoji">
									{c.emoji}
								</span>
								<span className="max-w-40 truncate">{c.label}</span>
								<button
									type="button"
									aria-label={t("tracker.settings.remove", { name: c.label })}
									onClick={() =>
										set({ categories: config.categories.filter((item) => item.id !== c.id) })
									}
									className="grid size-6 place-items-center rounded-full text-ink-muted hover:bg-hover hover:text-ink"
								>
									<X className="size-3.5" aria-hidden="true" />
								</button>
							</li>
						))}
					</ul>
				) : null}
				<div className="flex gap-2">
					<input
						type="text"
						aria-label={t("tracker.settings.emoji")}
						value={emoji}
						maxLength={8}
						placeholder="🏷️"
						onChange={(event) => setEmoji(event.target.value)}
						className={cn(controlClass, "h-10 w-14 shrink-0 px-2 text-center font-emoji")}
					/>
					<input
						id={labelId}
						type="text"
						value={label}
						maxLength={32}
						placeholder={t("tracker.settings.categoryName")}
						onChange={(event) => setLabel(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								addCategory();
							}
						}}
						className={cn(controlClass, "h-10 min-w-0 flex-1")}
					/>
					<button
						type="button"
						onClick={addCategory}
						disabled={!label.trim()}
						className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 font-medium text-ink text-small hover:bg-hover disabled:opacity-50"
					>
						<Plus className="size-4" aria-hidden="true" />
						{t("common.add")}
					</button>
				</div>
			</Row>
		</Stack>
	);
}

// ── Reading, workout, writing ─────────────────────────────────────────────

function ReadingSettings({ config, set }: SettingsProps<"reading">) {
	const { t } = useT();
	return (
		<Choice
			label={t("tracker.settings.measure")}
			value={config.measure}
			onChange={(measure) => set({ measure })}
			options={[
				{ value: "pages", label: t("tracker.settings.measure.pages") },
				{ value: "minutes", label: t("tracker.settings.measure.minutes") },
			]}
		/>
	);
}

function WorkoutSettings({ config, set }: SettingsProps<"workout">) {
	const { t } = useT();
	const id = useId();
	return (
		<Stack>
			<Choice
				label={t("tracker.settings.distanceUnit")}
				value={config.distanceUnit}
				onChange={(distanceUnit) => set({ distanceUnit })}
				options={[
					{ value: "km", label: "km" },
					{ value: "mi", label: "mi" },
				]}
			/>
			<Row label={t("tracker.settings.defaultActivity")} htmlFor={id}>
				<select
					id={id}
					value={config.defaultActivity ?? ""}
					onChange={(event) => set({ defaultActivity: event.target.value || null })}
					className={cn(controlClass, "h-11 pr-8")}
				>
					<option value="">{t("tracker.settings.anyActivity")}</option>
					{WORKOUT_ACTIVITIES.map((a) => (
						<option key={a.id} value={a.id}>
							{`${a.emoji} ${t(`tracker.activity.${a.id === "other" ? "misc" : a.id}`)}`}
						</option>
					))}
				</select>
			</Row>
		</Stack>
	);
}

function WritingSettings({ config, set }: SettingsProps<"writing">) {
	const { t } = useT();
	const id = useId();
	return (
		<Stack>
			<Choice
				label={t("tracker.settings.measure")}
				value={config.measure}
				onChange={(measure) => set({ measure })}
				options={[
					{ value: "words", label: t("tracker.settings.measure.words") },
					{ value: "entries", label: t("tracker.settings.measure.entries") },
				]}
			/>
			<Row label={t("tracker.settings.writingPrompt")} htmlFor={id}>
				<input
					id={id}
					type="text"
					maxLength={160}
					value={config.prompt ?? ""}
					placeholder={t("tracker.writing.placeholder")}
					onChange={(event) => set({ prompt: event.target.value || null })}
					className={cn(controlClass, "h-11")}
				/>
			</Row>
			<SwitchRow
				label={t("tracker.settings.onThisDay")}
				checked={config.onThisDay}
				onChange={(onThisDay) => set({ onThisDay })}
			/>
		</Stack>
	);
}

// ── Session ───────────────────────────────────────────────────────────────

function SessionSettings({ config, set }: SettingsProps<"session">) {
	const { t } = useT();
	const presetId = useId();
	const countdown = config.preset !== null;
	return (
		<Stack>
			<Choice
				label={t("tracker.settings.measure")}
				value={config.measure}
				onChange={(measure) => set({ measure })}
				options={[
					{ value: "minutes", label: t("tracker.settings.measure.minutes") },
					{ value: "sessions", label: t("tracker.settings.measure.sessions") },
				]}
			/>
			<Choice
				label={t("tracker.type.session.name")}
				value={countdown ? "countdown" : "stopwatch"}
				onChange={(mode) => set({ preset: mode === "countdown" ? (config.preset ?? 10) : null })}
				options={[
					{ value: "countdown", label: t("tracker.session.countdown") },
					{ value: "stopwatch", label: t("tracker.session.stopwatch") },
				]}
			/>
			{countdown ? (
				<Row label={t("tracker.session.length")} htmlFor={presetId}>
					<NumberField
						id={presetId}
						value={config.preset}
						min={1}
						max={240}
						onChange={(preset) => set({ preset: preset ?? 1 })}
						suffix={t("tracker.minutesShort")}
						stepper
						className="w-32"
					/>
				</Row>
			) : null}
			<Choice
				label={t("tracker.settings.prompt")}
				value={config.prompt}
				onChange={(prompt) => set({ prompt })}
				options={[
					{ value: "none", label: t("tracker.settings.promptNone") },
					{ value: "learned", label: t("tracker.session.learnedPrompt") },
					{ value: "felt", label: t("tracker.session.feltPrompt") },
				]}
			/>
			<SwitchRow
				label={t("tracker.settings.bell")}
				checked={config.bell}
				onChange={(bell) => set({ bell })}
			/>
			<ChipList
				label={t("tracker.settings.topics")}
				hint={t("tracker.settings.topicsHint")}
				items={config.labels}
				max={12}
				maxLength={60}
				placeholder={t("tracker.session.labelPlaceholder")}
				onChange={(labels) => set({ labels })}
			/>
		</Stack>
	);
}

// ── Wake and sleep ────────────────────────────────────────────────────────

function ClockSettings({ config, set }: SettingsProps<"wake" | "sleep">) {
	const { t } = useT();
	const timeId = useId();
	const graceId = useId();
	const time = config.type === "wake" ? config.time : config.bedtime;
	return (
		<Stack>
			<div className="flex flex-wrap gap-4">
				<Row
					label={config.type === "wake" ? t("tracker.wake.target") : t("tracker.sleep.deadline")}
					htmlFor={timeId}
				>
					<TimeField
						id={timeId}
						value={time}
						clearable={false}
						onChange={(value) => {
							if (!value) return;
							if (config.type === "wake") set({ time: value } as Partial<Of<"wake">>);
							else set({ bedtime: value } as Partial<Of<"sleep">>);
						}}
						className="w-36"
					/>
				</Row>
				<Row label={t("tracker.wake.grace")} htmlFor={graceId}>
					<NumberField
						id={graceId}
						value={config.grace}
						min={0}
						max={120}
						step={5}
						onChange={(grace) => set({ grace: grace ?? 0 })}
						suffix={t("tracker.minutesShort")}
						className="w-32"
					/>
				</Row>
			</div>
			<p className="-mt-3 text-ink-subtle text-small">{t("tracker.settings.graceHint")}</p>
			{config.type === "sleep" ? (
				<SwitchRow
					label={t("tracker.settings.trackWake")}
					checked={config.trackWake}
					onChange={(trackWake) => set({ trackWake } as Partial<Of<"sleep">>)}
				/>
			) : null}
		</Stack>
	);
}

// ── Connection ────────────────────────────────────────────────────────────

function ConnectionSettings({ config, set }: SettingsProps<"connection">) {
	const { t } = useT();
	const nameId = useId();
	const [name, setName] = useState("");
	const [emoji, setEmoji] = useState("");
	const [every, setEvery] = useState<number | null>(null);
	const add = () => {
		const trimmed = name.trim().slice(0, 60);
		if (!trimmed || config.circle.length >= 30) return;
		set({
			circle: [...config.circle, { name: trimmed, emoji: emoji.trim() || "🫶", every }],
		});
		setName("");
		setEmoji("");
		setEvery(null);
	};
	return (
		<Row
			label={t("tracker.connection.circle")}
			hint={t("tracker.settings.circleHint")}
			htmlFor={nameId}
		>
			{config.circle.length ? (
				<ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
					{config.circle.map((person, index) => (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: names can repeat; order is stable.
							key={index}
							className="flex items-center gap-2 px-3 py-2"
						>
							<span aria-hidden="true" className="font-emoji">
								{person.emoji}
							</span>
							<span className="min-w-0 flex-1 truncate text-ink text-small">{person.name}</span>
							<NumberField
								aria-label={`${t("tracker.settings.every")} · ${person.name}`}
								value={person.every}
								min={1}
								max={365}
								onChange={(value) =>
									set({
										circle: config.circle.map((p, i) => (i === index ? { ...p, every: value } : p)),
									})
								}
								suffix={t("tracker.settings.everySuffix")}
								className="h-9 w-28"
							/>
							<button
								type="button"
								aria-label={t("tracker.settings.remove", { name: person.name })}
								onClick={() => set({ circle: config.circle.filter((_, i) => i !== index) })}
								className="grid size-8 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-hover hover:text-ink"
							>
								<X className="size-4" aria-hidden="true" />
							</button>
						</li>
					))}
				</ul>
			) : null}
			<div className="flex flex-wrap gap-2">
				<input
					type="text"
					aria-label={t("tracker.settings.emoji")}
					value={emoji}
					maxLength={8}
					placeholder="🫶"
					onChange={(event) => setEmoji(event.target.value)}
					className={cn(controlClass, "h-10 w-14 shrink-0 px-2 text-center font-emoji")}
				/>
				<input
					id={nameId}
					type="text"
					value={name}
					maxLength={60}
					placeholder={t("tracker.settings.personName")}
					onChange={(event) => setName(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							add();
						}
					}}
					className={cn(controlClass, "h-10 min-w-0 flex-[1_1_8rem]")}
				/>
				<NumberField
					aria-label={t("tracker.settings.every")}
					value={every}
					min={1}
					max={365}
					onChange={setEvery}
					placeholder="14"
					suffix={t("tracker.settings.everySuffix")}
					className="h-10 w-28"
				/>
				<button
					type="button"
					onClick={add}
					disabled={!name.trim()}
					className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 font-medium text-ink text-small hover:bg-hover disabled:opacity-50"
				>
					<Plus className="size-4" aria-hidden="true" />
					{t("tracker.settings.addPerson")}
				</button>
			</div>
		</Row>
	);
}

// ── Slip ──────────────────────────────────────────────────────────────────

function SlipSettings({ config, set }: SettingsProps<"slip">) {
	const { t } = useT();
	return (
		<Stack>
			<Choice
				label={t("tracker.settings.cost")}
				value={config.cost}
				onChange={(cost) => set({ cost })}
				options={[
					{ value: "none", label: t("tracker.settings.cost.none") },
					{ value: "money", label: t("tracker.settings.cost.money") },
					{ value: "time", label: t("tracker.settings.cost.time") },
				]}
			/>
			{config.cost === "money" ? (
				<CurrencySelect value={config.currency} onChange={(currency) => set({ currency })} />
			) : null}
		</Stack>
	);
}

// ── Later milestones (4B, 4C) ─────────────────────────────────────────────

function PlanSettings({ config, set }: SettingsProps<"plan">) {
	const { t } = useT();
	const id = useId();
	return (
		<Row label={t("tracker.settings.planSize")} htmlFor={id}>
			<NumberField
				id={id}
				value={config.size}
				min={1}
				max={5}
				stepper
				onChange={(size) => set({ size: size ?? 3 })}
				className="w-20"
			/>
		</Row>
	);
}

function MeasureSettings({ config, set }: SettingsProps<"measure">) {
	const { t } = useT();
	const unitId = useId();
	const decimalsId = useId();
	return (
		<Stack>
			<Row label={t("tracker.settings.unit")} htmlFor={unitId}>
				<input
					id={unitId}
					type="text"
					maxLength={16}
					value={config.unit}
					onChange={(event) => set({ unit: event.target.value })}
					className={cn(controlClass, "h-11 max-w-56")}
				/>
			</Row>
			<Choice
				label={t("tracker.settings.aggregate")}
				value={config.aggregate}
				onChange={(aggregate) => set({ aggregate })}
				options={[
					{ value: "sum", label: t("tracker.settings.aggregate.sum") },
					{ value: "last", label: t("tracker.settings.aggregate.last") },
				]}
			/>
			<Row label={t("tracker.settings.decimals")} htmlFor={decimalsId}>
				<NumberField
					id={decimalsId}
					value={config.decimals}
					min={0}
					max={3}
					stepper
					onChange={(decimals) => set({ decimals: decimals ?? 0 })}
					className="w-20"
				/>
			</Row>
			<Choice
				label={t("tracker.settings.direction")}
				value={config.direction ?? "none"}
				onChange={(direction) => set({ direction: direction === "none" ? null : direction })}
				options={[
					{ value: "up", label: t("tracker.settings.direction.up") },
					{ value: "down", label: t("tracker.settings.direction.down") },
					{ value: "none", label: t("tracker.settings.direction.none") },
				]}
			/>
		</Stack>
	);
}

function PhotoSettings({ config, set }: SettingsProps<"photo">) {
	const { t } = useT();
	return (
		<Stack>
			<SwitchRow
				label={t("tracker.photo.compare")}
				checked={config.compare}
				onChange={(compare) => set({ compare })}
			/>
			<SwitchRow
				label={t("tracker.settings.photoRequired")}
				checked={config.photoRequired}
				onChange={(photoRequired) => set({ photoRequired })}
			/>
		</Stack>
	);
}
