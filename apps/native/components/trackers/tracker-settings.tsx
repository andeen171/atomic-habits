import { Check, ChevronDown, Plus, X } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { IconButton } from "@/components/ui/icon-button";
import { NumberField } from "@/components/ui/number-field";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { TimeField } from "@/components/ui/time-field";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
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
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";

/**
 * A tracker's settings, per type (Annex K §4.1, §5.1 `tracker-settings.tsx`):
 * currency, budget and categories (expense); what to count (reading,
 * session, writing); the timer, prompt, bell and pinned topics (session);
 * target time and grace (wake, sleep); the circle (connection); the cost
 * (slip); and the 4B/4C options. Used inline by the editor's tracker picker
 * and by the Tracker settings sheet. Owner: T4.
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
	return <View style={{ gap: 20 }}>{children}</View>;
}

/** A labelled control with an optional hint. */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	const styles = useStyles();
	return (
		<View style={styles.row}>
			<Text
				variant="small"
				weight="medium"
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
			>
				{label}
			</Text>
			{children}
			{hint ? (
				<Text variant="small" tone="subtle">
					{hint}
				</Text>
			) : null}
		</View>
	);
}

function SwitchRow({
	label,
	hint,
	value,
	onChange,
}: {
	label: string;
	hint?: string;
	value: boolean;
	onChange(value: boolean): void;
}) {
	const styles = useStyles();
	return (
		<View style={styles.switchRow}>
			<View style={styles.grow}>
				<Text variant="small" weight="medium">
					{label}
				</Text>
				{hint ? (
					<Text variant="small" tone="subtle">
						{hint}
					</Text>
				) : null}
			</View>
			<Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
		</View>
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
				size="sm"
				accessibilityLabel={label}
				value={value}
				onChange={onChange}
				options={options}
			/>
		</Row>
	);
}

/**
 * A value picked from a list in a sheet (currency, default activity): the
 * field shows the choice; the sheet lists every option as a radio row.
 */
export function SelectField<T extends string>({
	label,
	value,
	options,
	onChange,
	testID,
}: {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onChange(value: T): void;
	testID?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	const [open, setOpen] = useState(false);
	const current = options.find((o) => o.value === value)?.label ?? value;
	return (
		<Row label={label}>
			<Pressable
				onPress={() => {
					haptics.selection();
					setOpen(true);
				}}
				accessibilityRole="button"
				accessibilityLabel={`${label}: ${current}`}
				style={({ pressed }) => [styles.select, pressed && { backgroundColor: colors.hover }]}
				testID={testID}
			>
				<Text style={styles.grow} numberOfLines={1}>
					{current}
				</Text>
				<ChevronDown size={18} color={colors.textMuted} />
			</Pressable>
			<Sheet open={open} onClose={() => setOpen(false)} title={label} scroll>
				<View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.options}>
					{options.map((option) => {
						const selected = option.value === value;
						return (
							<Pressable
								key={option.value}
								onPress={() => {
									haptics.selection();
									onChange(option.value);
									setOpen(false);
								}}
								accessibilityRole="radio"
								accessibilityState={{ selected, checked: selected }}
								accessibilityLabel={option.label}
								style={({ pressed }) => [
									styles.option,
									pressed && { backgroundColor: colors.hover },
								]}
							>
								<Text style={styles.grow} weight={selected ? "semibold" : "regular"}>
									{option.label}
								</Text>
								{selected ? <Check size={18} color={colors.accentText} strokeWidth={2.4} /> : null}
							</Pressable>
						);
					})}
				</View>
			</Sheet>
		</Row>
	);
}

function CurrencySelect({ value, onChange }: { value: string; onChange(code: string): void }) {
	const t = useT();
	const options = CURRENCY_CODES.map((code) => ({
		value: code as string,
		label: `${CURRENCIES[code].name[t.locale]} (${currencySymbol(code, t.locale)})`,
	}));
	if (!options.some((o) => o.value === value)) options.push({ value, label: value });
	return (
		<SelectField
			label={t.t("tracker.settings.currency")}
			value={value}
			options={options}
			onChange={onChange}
			testID="tracker-currency"
		/>
	);
}

/** A removable pill (a custom category, a pinned topic). */
function RemovableChip({
	label,
	emoji,
	onRemove,
}: {
	label: string;
	emoji?: string;
	onRemove(): void;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View style={styles.removable}>
			{emoji ? (
				<Text style={styles.emoji} allowFontScaling={false}>
					{emoji}
				</Text>
			) : null}
			<Text variant="small" numberOfLines={1} style={styles.removableLabel}>
				{label}
			</Text>
			<PressableScale
				onPress={() => {
					haptics.selection();
					onRemove();
				}}
				hitSlop={10}
				accessibilityRole="button"
				accessibilityLabel={t.t("tracker.settings.remove", { name: label })}
				style={styles.remove}
			>
				<X size={14} color={colors.textMuted} strokeWidth={2.2} />
			</PressableScale>
		</View>
	);
}

/** "＋ Add" next to a field. */
function AddButton({
	label,
	disabled,
	onPress,
}: {
	label: string;
	disabled?: boolean;
	onPress(): void;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<PressableScale
			onPress={onPress}
			disabled={disabled}
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled: !!disabled }}
			style={[styles.addButton, disabled && { opacity: 0.45 }]}
		>
			<Plus size={16} color={colors.text} strokeWidth={2.2} />
			<Text variant="small" weight="medium" numberOfLines={1}>
				{label}
			</Text>
		</PressableScale>
	);
}

/** Editable chips (pinned topics): remove with ×, add from a field. */
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
	const t = useT();
	const styles = useStyles();
	const [draft, setDraft] = useState("");
	const add = () => {
		const value = draft.trim().slice(0, maxLength);
		if (!value || items.some((item) => item.toLowerCase() === value.toLowerCase())) {
			setDraft("");
			return;
		}
		haptics.selection();
		onChange([...items, value].slice(0, max));
		setDraft("");
	};
	return (
		<Row label={label} hint={hint}>
			{items.length ? (
				<View style={styles.wrap}>
					{items.map((item) => (
						<RemovableChip
							key={item}
							label={item}
							onRemove={() => onChange(items.filter((i) => i !== item))}
						/>
					))}
				</View>
			) : null}
			{items.length < max ? (
				<View style={styles.addRow}>
					<TextField
						value={draft}
						onChangeText={setDraft}
						maxLength={maxLength}
						placeholder={placeholder}
						accessibilityLabel={label}
						onSubmitEditing={add}
						returnKeyType="done"
						containerStyle={styles.grow}
					/>
					<AddButton label={t.t("common.add")} disabled={!draft.trim()} onPress={add} />
				</View>
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
	const t = useT();
	const styles = useStyles();
	const [budgetText, setBudgetText] = useState(() =>
		moneyInputValue(config.budget, config.currency, t.locale),
	);
	const [emoji, setEmoji] = useState("");
	const [label, setLabel] = useState("");
	const ids = EXPENSE_CATEGORIES.map((c) => c.id as string);
	const visible = ids.filter((id) => !config.hidden.includes(id));

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
		haptics.selection();
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
			<Row label={t.t("tracker.expense.budget")} hint={t.t("tracker.settings.budgetHint")}>
				<TextField
					value={budgetText}
					onChangeText={setBudgetText}
					onBlur={() => commitBudget(budgetText)}
					onSubmitEditing={() => commitBudget(budgetText)}
					prefix={currencySymbol(config.currency, t.locale)}
					placeholder={moneyInputValue(0, config.currency, t.locale)}
					keyboardType="decimal-pad"
					inputMode="decimal"
					returnKeyType="done"
					accessibilityLabel={t.t("tracker.expense.budget")}
					style={styles.tabular}
					testID="tracker-budget"
				/>
			</Row>
			<Row label={t.t("tracker.settings.categories")} hint={t.t("tracker.settings.categoriesHint")}>
				<ToggleGroup
					type="multiple"
					size="sm"
					accessibilityLabel={t.t("tracker.settings.categories")}
					value={visible}
					onChange={(shown) => {
						// At least one built-in category stays.
						if (!shown.length) return;
						set({ hidden: ids.filter((id) => !shown.includes(id)) });
					}}
					options={EXPENSE_CATEGORIES.map((c) => ({
						value: c.id as string,
						label: `${c.emoji} ${t.t(`tracker.category.${c.id === "other" ? "misc" : c.id}`)}`,
					}))}
				/>
			</Row>
			<Row label={t.t("tracker.settings.addCategory")}>
				{config.categories.length ? (
					<View style={styles.wrap}>
						{config.categories.map((c) => (
							<RemovableChip
								key={c.id}
								label={c.label}
								emoji={c.emoji}
								onRemove={() =>
									set({ categories: config.categories.filter((item) => item.id !== c.id) })
								}
							/>
						))}
					</View>
				) : null}
				<View style={styles.addRow}>
					<TextField
						value={emoji}
						onChangeText={setEmoji}
						maxLength={8}
						placeholder="🏷️"
						accessibilityLabel={t.t("tracker.settings.emoji")}
						containerStyle={styles.emojiField}
						style={styles.center}
					/>
					<TextField
						value={label}
						onChangeText={setLabel}
						maxLength={32}
						placeholder={t.t("tracker.settings.categoryName")}
						accessibilityLabel={t.t("tracker.settings.categoryName")}
						onSubmitEditing={addCategory}
						returnKeyType="done"
						containerStyle={styles.grow}
					/>
					<AddButton label={t.t("common.add")} disabled={!label.trim()} onPress={addCategory} />
				</View>
			</Row>
		</Stack>
	);
}

// ── Reading, workout, writing ─────────────────────────────────────────────

function ReadingSettings({ config, set }: SettingsProps<"reading">) {
	const t = useT();
	return (
		<Choice
			label={t.t("tracker.settings.measure")}
			value={config.measure}
			onChange={(measure) => set({ measure })}
			options={[
				{ value: "pages", label: t.t("tracker.settings.measure.pages") },
				{ value: "minutes", label: t.t("tracker.settings.measure.minutes") },
			]}
		/>
	);
}

function WorkoutSettings({ config, set }: SettingsProps<"workout">) {
	const t = useT();
	const ANY = "__any";
	return (
		<Stack>
			<Choice
				label={t.t("tracker.settings.distanceUnit")}
				value={config.distanceUnit}
				onChange={(distanceUnit) => set({ distanceUnit })}
				options={[
					{ value: "km", label: "km" },
					{ value: "mi", label: "mi" },
				]}
			/>
			<SelectField
				label={t.t("tracker.settings.defaultActivity")}
				value={config.defaultActivity ?? ANY}
				onChange={(value) => set({ defaultActivity: value === ANY ? null : value })}
				options={[
					{ value: ANY, label: t.t("tracker.settings.anyActivity") },
					...WORKOUT_ACTIVITIES.map((a) => ({
						value: a.id as string,
						label: `${a.emoji} ${t.t(`tracker.activity.${a.id === "other" ? "misc" : a.id}`)}`,
					})),
				]}
			/>
		</Stack>
	);
}

function WritingSettings({ config, set }: SettingsProps<"writing">) {
	const t = useT();
	return (
		<Stack>
			<Choice
				label={t.t("tracker.settings.measure")}
				value={config.measure}
				onChange={(measure) => set({ measure })}
				options={[
					{ value: "words", label: t.t("tracker.settings.measure.words") },
					{ value: "entries", label: t.t("tracker.settings.measure.entries") },
				]}
			/>
			<Row label={t.t("tracker.settings.writingPrompt")}>
				<TextField
					value={config.prompt ?? ""}
					onChangeText={(prompt) => set({ prompt: prompt || null })}
					maxLength={160}
					placeholder={t.t("tracker.writing.placeholder")}
					accessibilityLabel={t.t("tracker.settings.writingPrompt")}
				/>
			</Row>
			<SwitchRow
				label={t.t("tracker.settings.onThisDay")}
				value={config.onThisDay}
				onChange={(onThisDay) => set({ onThisDay })}
			/>
		</Stack>
	);
}

// ── Session ───────────────────────────────────────────────────────────────

function SessionSettings({ config, set }: SettingsProps<"session">) {
	const t = useT();
	const countdown = config.preset !== null;
	return (
		<Stack>
			<Choice
				label={t.t("tracker.settings.measure")}
				value={config.measure}
				onChange={(measure) => set({ measure })}
				options={[
					{ value: "minutes", label: t.t("tracker.settings.measure.minutes") },
					{ value: "sessions", label: t.t("tracker.settings.measure.sessions") },
				]}
			/>
			<Choice
				label={t.t("tracker.session.mode")}
				value={countdown ? "countdown" : "stopwatch"}
				onChange={(mode) => set({ preset: mode === "countdown" ? (config.preset ?? 10) : null })}
				options={[
					{ value: "countdown", label: t.t("tracker.session.countdown") },
					{ value: "stopwatch", label: t.t("tracker.session.stopwatch") },
				]}
			/>
			{countdown ? (
				<NumberField
					label={t.t("tracker.session.length")}
					value={config.preset}
					min={1}
					max={240}
					step={1}
					unit={t.t("tracker.minutesShort")}
					onChange={(preset) => set({ preset: preset ?? 1 })}
				/>
			) : null}
			<Choice
				label={t.t("tracker.settings.prompt")}
				value={config.prompt}
				onChange={(prompt) => set({ prompt })}
				options={[
					{ value: "none", label: t.t("tracker.settings.promptNone") },
					{ value: "learned", label: t.t("tracker.session.learnedPrompt") },
					{ value: "felt", label: t.t("tracker.session.feltPrompt") },
				]}
			/>
			<SwitchRow
				label={t.t("tracker.settings.bell")}
				value={config.bell}
				onChange={(bell) => set({ bell })}
			/>
			<ChipList
				label={t.t("tracker.settings.topics")}
				hint={t.t("tracker.settings.topicsHint")}
				items={config.labels}
				max={12}
				maxLength={60}
				placeholder={t.t("tracker.session.labelPlaceholder")}
				onChange={(labels) => set({ labels })}
			/>
		</Stack>
	);
}

// ── Wake and sleep ────────────────────────────────────────────────────────

function ClockSettings({ config, set }: SettingsProps<"wake" | "sleep">) {
	const t = useT();
	const styles = useStyles();
	const time = config.type === "wake" ? config.time : config.bedtime;
	const label = config.type === "wake" ? t.t("tracker.wake.target") : t.t("tracker.sleep.deadline");
	return (
		<Stack>
			<View style={styles.pair}>
				<TimeField
					label={label}
					value={time}
					clearable={false}
					minuteStep={5}
					onChange={(value) => {
						if (!value) return;
						if (config.type === "wake") set({ time: value } as Partial<Of<"wake">>);
						else set({ bedtime: value } as Partial<Of<"sleep">>);
					}}
					style={styles.grow}
					testID="tracker-clock-time"
				/>
				<NumberField
					label={t.t("tracker.wake.grace")}
					value={config.grace}
					min={0}
					max={120}
					unit={t.t("tracker.minutesShort")}
					onChange={(grace) => set({ grace: grace ?? 0 })}
					containerStyle={styles.grow}
				/>
			</View>
			<Text variant="small" tone="subtle" style={styles.pullUp}>
				{t.t("tracker.settings.graceHint")}
			</Text>
			{config.type === "sleep" ? (
				<SwitchRow
					label={t.t("tracker.settings.trackWake")}
					value={config.trackWake}
					onChange={(trackWake) => set({ trackWake } as Partial<Of<"sleep">>)}
				/>
			) : null}
		</Stack>
	);
}

// ── Connection ────────────────────────────────────────────────────────────

function ConnectionSettings({ config, set }: SettingsProps<"connection">) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [name, setName] = useState("");
	const [emoji, setEmoji] = useState("");
	const [every, setEvery] = useState<number | null>(null);
	const add = () => {
		const trimmed = name.trim().slice(0, 60);
		if (!trimmed || config.circle.length >= 30) return;
		haptics.selection();
		set({ circle: [...config.circle, { name: trimmed, emoji: emoji.trim() || "🫶", every }] });
		setName("");
		setEmoji("");
		setEvery(null);
	};
	return (
		<Row label={t.t("tracker.connection.circle")} hint={t.t("tracker.settings.circleHint")}>
			{config.circle.length ? (
				<View style={styles.people}>
					{config.circle.map((person, index) => (
						<View
							// biome-ignore lint/suspicious/noArrayIndexKey: names can repeat; order is stable.
							key={index}
							style={[
								styles.person,
								index > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
							]}
						>
							<Text style={styles.emoji} allowFontScaling={false}>
								{person.emoji}
							</Text>
							<Text style={styles.grow} numberOfLines={1}>
								{person.name}
							</Text>
							<NumberField
								accessibilityLabel={`${t.t("tracker.settings.every")} · ${person.name}`}
								value={person.every}
								min={1}
								max={365}
								placeholder="—"
								prefix={t.t("tracker.settings.everyPrefix")}
								unit={t.t("tracker.settings.everySuffix")}
								onChange={(value) =>
									set({
										circle: config.circle.map((p, i) => (i === index ? { ...p, every: value } : p)),
									})
								}
								containerStyle={styles.everyField}
							/>
							<IconButton
								icon={X}
								size={32}
								iconSize={16}
								color={colors.textMuted}
								accessibilityLabel={t.t("tracker.settings.remove", { name: person.name })}
								onPress={() => set({ circle: config.circle.filter((_, i) => i !== index) })}
							/>
						</View>
					))}
				</View>
			) : null}
			<View style={styles.addRow}>
				<TextField
					value={emoji}
					onChangeText={setEmoji}
					maxLength={8}
					placeholder="🫶"
					accessibilityLabel={t.t("tracker.settings.emoji")}
					containerStyle={styles.emojiField}
					style={styles.center}
				/>
				<TextField
					value={name}
					onChangeText={setName}
					maxLength={60}
					placeholder={t.t("tracker.settings.personName")}
					accessibilityLabel={t.t("tracker.settings.personName")}
					onSubmitEditing={add}
					returnKeyType="done"
					containerStyle={styles.grow}
				/>
			</View>
			<View style={styles.addRow}>
				<NumberField
					accessibilityLabel={t.t("tracker.settings.every")}
					value={every}
					min={1}
					max={365}
					placeholder="14"
					prefix={t.t("tracker.settings.everyPrefix")}
					unit={t.t("tracker.settings.everySuffix")}
					onChange={setEvery}
					containerStyle={styles.grow}
				/>
				<AddButton
					label={t.t("tracker.settings.addPerson")}
					disabled={!name.trim()}
					onPress={add}
				/>
			</View>
		</Row>
	);
}

// ── Slip ──────────────────────────────────────────────────────────────────

function SlipSettings({ config, set }: SettingsProps<"slip">) {
	const t = useT();
	return (
		<Stack>
			<Choice
				label={t.t("tracker.settings.cost")}
				value={config.cost}
				onChange={(cost) => set({ cost })}
				options={[
					{ value: "none", label: t.t("tracker.settings.cost.none") },
					{ value: "money", label: t.t("tracker.settings.cost.money") },
					{ value: "time", label: t.t("tracker.settings.cost.time") },
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
	const t = useT();
	return (
		<NumberField
			label={t.t("tracker.settings.planSize")}
			hint={t.t("tracker.settings.planSizeHint")}
			value={config.size}
			min={1}
			max={5}
			step={1}
			onChange={(size) => set({ size: size ?? 3 })}
		/>
	);
}

function MeasureSettings({ config, set }: SettingsProps<"measure">) {
	const t = useT();
	return (
		<Stack>
			<Row label={t.t("tracker.settings.unit")} hint={t.t("tracker.settings.unitHint")}>
				<TextField
					value={config.unit}
					onChangeText={(unit) => set({ unit })}
					maxLength={16}
					placeholder="kg"
					autoCapitalize="none"
					accessibilityLabel={t.t("tracker.settings.unit")}
					accessibilityHint={t.t("tracker.settings.unitHint")}
				/>
			</Row>
			<Choice
				label={t.t("tracker.settings.aggregate")}
				hint={t.t("tracker.settings.aggregateHint")}
				value={config.aggregate}
				onChange={(aggregate) => set({ aggregate })}
				options={[
					{ value: "sum", label: t.t("tracker.settings.aggregate.sum") },
					{ value: "last", label: t.t("tracker.settings.aggregate.last") },
				]}
			/>
			<NumberField
				label={t.t("tracker.settings.decimals")}
				value={config.decimals}
				min={0}
				max={3}
				step={1}
				onChange={(decimals) => set({ decimals: decimals ?? 0 })}
			/>
			<Choice
				label={t.t("tracker.settings.direction")}
				value={config.direction ?? "none"}
				onChange={(direction) => set({ direction: direction === "none" ? null : direction })}
				options={[
					{ value: "up", label: t.t("tracker.settings.direction.up") },
					{ value: "down", label: t.t("tracker.settings.direction.down") },
					{ value: "none", label: t.t("tracker.settings.direction.none") },
				]}
			/>
		</Stack>
	);
}

function PhotoSettings({ config, set }: SettingsProps<"photo">) {
	const t = useT();
	return (
		<Stack>
			<SwitchRow
				label={t.t("tracker.photo.compare")}
				hint={t.t("tracker.settings.compareHint")}
				value={config.compare}
				onChange={(compare) => set({ compare })}
			/>
			<SwitchRow
				label={t.t("tracker.settings.photoRequired")}
				hint={t.t("tracker.settings.photoRequiredHint")}
				value={config.photoRequired}
				onChange={(photoRequired) => set({ photoRequired })}
			/>
			<Row label={t.t("tracker.settings.captionPrompt")}>
				<TextField
					value={config.prompt ?? ""}
					onChangeText={(prompt) => set({ prompt: prompt || null })}
					maxLength={160}
					placeholder={t.t("tracker.photo.captionPlaceholder")}
					accessibilityLabel={t.t("tracker.settings.captionPrompt")}
				/>
			</Row>
		</Stack>
	);
}

const useStyles = makeStyles((t) => ({
	row: { gap: 8 },
	grow: { flex: 1 },
	tabular: { fontVariant: ["tabular-nums"] },
	center: { textAlign: "center" },
	wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	switchRow: { flexDirection: "row", alignItems: "center", gap: 16 },
	pair: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
	pullUp: { marginTop: -12 },
	select: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		minHeight: 48,
		paddingHorizontal: 14,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	options: { marginHorizontal: -8, paddingBottom: 8 },
	option: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		minHeight: 50,
		paddingHorizontal: 8,
		borderRadius: t.radii.md,
	},
	removable: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		height: 36,
		maxWidth: "100%",
		paddingLeft: 12,
		paddingRight: 4,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	removableLabel: { flexShrink: 1 },
	remove: {
		width: 28,
		height: 28,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
	},
	emoji: { fontSize: 16, lineHeight: 20 },
	addRow: { flexDirection: "row", alignItems: "center", gap: 8 },
	emojiField: { width: 64 },
	addButton: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		height: 48,
		paddingHorizontal: 14,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	people: {
		borderRadius: t.radii.md,
		borderWidth: 1,
		borderColor: t.colors.border,
		overflow: "hidden",
	},
	person: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		paddingLeft: 12,
		paddingRight: 4,
		paddingVertical: 6,
	},
	everyField: { width: 150 },
}));
