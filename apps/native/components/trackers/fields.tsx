import { ImageOff, Plus } from "@/components/icons";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { TimeField } from "@/components/ui/time-field";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { fonts, makeStyles, useTheme } from "@/lib/theme";
import {
	type AttachmentRef,
	CURRENCIES,
	type DayKey,
	type FieldSpec,
	type FormValue,
	type ShelfBook,
	foldText,
	isCurrencyCode,
	moneyInputValue,
	parseClockInput,
	parseDecimalInput,
	parseDurationInput,
} from "@atomic/core";
import { type ReactNode, type Ref, useEffect, useMemo, useRef, useState } from "react";
import {
	type LayoutChangeEvent,
	Platform,
	ScrollView,
	type StyleProp,
	TextInput,
	type TextStyle,
	View,
} from "react-native";
import { trackerCaps } from "./caps";
import { PhotoPicker } from "./photo-field";

/**
 * One renderer per composer `FieldSpec` kind (Annex K §3.4, §5.1), the
 * native twin of web `field-renderers.tsx`. Core describes the fields and
 * parses every value (`formToData`), so these only collect text: money,
 * numbers, durations and clock times stay as typed until the composer
 * saves, and both apps store exactly the same thing. Owner: T4.
 */
export interface FieldRendererProps {
	spec: FieldSpec;
	value: FormValue | undefined;
	onChange(value: FormValue): void;
	/** Translated `formToData` error for this field. */
	error?: string;
	/** Books for the `book` field (`useBooks`). */
	books?: readonly ShelfBook[];
	/** "+ New book" from the `book` field. */
	onNewBook?(): void;
	/** The field's text input, for the composer's first focus. */
	inputRef?: Ref<TextInput>;
	/** Return key on single-line inputs (saves the form). */
	onSubmit?(): void;
	/** Large and centred: the one number the entry is about (a number log's value). */
	hero?: boolean;
	/** The entry's day (photos: the viewer's date line). */
	day?: DayKey;
	/** Photos are being prepared: the composer holds Save until they're in. */
	onBusyChange?(busy: boolean): void;
}

export function FieldRenderer(props: FieldRendererProps) {
	const { spec } = props;
	switch (spec.kind) {
		case "money":
			return <MoneyField {...props} spec={spec} />;
		case "number":
			return <NumberInput {...props} spec={spec} />;
		case "duration":
			return <DurationField {...props} spec={spec} />;
		case "clock":
			return <ClockField {...props} spec={spec} />;
		case "choice":
			return <ChoiceField {...props} spec={spec} />;
		case "text":
			return <TextInputField {...props} spec={spec} />;
		case "longtext":
			return <LongTextField {...props} spec={spec} />;
		case "rating":
			return <RatingField {...props} spec={spec} />;
		case "book":
			return <BookField {...props} spec={spec} />;
		case "lines":
			return <LinesField {...props} spec={spec} />;
		case "day":
			return <DayField {...props} spec={spec} />;
		case "photos":
			return <PhotosField {...props} spec={spec} />;
	}
}

/** Kinds that take typing first: the composer focuses them when they lead the form. */
export function isTypingField(spec: FieldSpec | undefined): boolean {
	return (
		!!spec &&
		(spec.kind === "money" ||
			spec.kind === "number" ||
			spec.kind === "duration" ||
			spec.kind === "text" ||
			spec.kind === "lines")
	);
}

type SpecOf<K extends FieldSpec["kind"]> = Extract<FieldSpec, { kind: K }>;
type KindProps<K extends FieldSpec["kind"]> = Omit<FieldRendererProps, "spec"> & {
	spec: SpecOf<K>;
};

const asText = (value: FormValue | undefined): string =>
	typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

/** "Optional" beside the label of fields that aren't required. */
function FieldLabel({ spec, accessible = true }: { spec: FieldSpec; accessible?: boolean }) {
	const t = useT();
	const styles = useStyles();
	return (
		<View
			style={styles.labelRow}
			accessible={accessible}
			importantForAccessibility={accessible ? "auto" : "no-hide-descendants"}
			accessibilityElementsHidden={!accessible}
		>
			<Text variant="small" weight="medium" style={styles.labelText}>
				{spec.label}
			</Text>
			{spec.required ? null : (
				<Text variant="tiny" tone="subtle">
					{t.t("common.optional")}
				</Text>
			)}
		</View>
	);
}

/** The error (announced) or the hint under a field. */
function FieldNote({ spec, error }: { spec: FieldSpec; error?: string }) {
	const note = error ?? spec.hint;
	if (!note) return null;
	return (
		<Text
			variant="small"
			tone={error ? "danger" : "subtle"}
			accessibilityLiveRegion={error ? "polite" : "none"}
			accessibilityRole={error ? "alert" : undefined}
		>
			{note}
		</Text>
	);
}

/** Label, control, then the error or hint. */
function FieldShell({
	spec,
	error,
	children,
	labelHidden,
}: {
	spec: FieldSpec;
	error?: string;
	/** The control names itself (inputs): the visible label stays out of the screen-reader order. */
	labelHidden?: boolean;
	children: ReactNode;
}) {
	const styles = useStyles();
	return (
		<View style={styles.field}>
			<FieldLabel spec={spec} accessible={!labelHidden} />
			{children}
			<FieldNote spec={spec} error={error} />
		</View>
	);
}

/** "Amount (BRL)", "Pages, optional" — what a screen reader hears for an input. */
function inputName(spec: FieldSpec, optional: string, extra?: string): string {
	return [extra ? `${spec.label} (${extra})` : spec.label, spec.required ? null : optional]
		.filter(Boolean)
		.join(", ");
}

// ── Money ─────────────────────────────────────────────────────────────────

function MoneyField({ spec, value, onChange, error, inputRef, onSubmit }: KindProps<"money">) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [focused, setFocused] = useState(false);
	const [width, setWidth] = useState(0);
	const currency = isCurrencyCode(spec.currency)
		? CURRENCIES[spec.currency].name[t.locale]
		: spec.currency;
	const placeholder = moneyInputValue(0, spec.currency, t.locale);
	const text = asText(value);
	const name = inputName(spec, t.t("common.optional"), currency);
	if (!spec.hero) {
		return (
			<FieldShell spec={spec} error={error} labelHidden>
				<TextField
					ref={inputRef}
					value={text}
					onChangeText={onChange}
					prefix={spec.symbol}
					placeholder={placeholder}
					keyboardType="decimal-pad"
					inputMode="decimal"
					returnKeyType="done"
					onSubmitEditing={onSubmit}
					error={error ? "" : null}
					accessibilityLabel={name}
					style={styles.tabular}
				/>
			</FieldShell>
		);
	}
	// The big amount (expense): the symbol and the number stay one centred group, sized to the text.
	const sizer = (event: LayoutChangeEvent) => setWidth(Math.ceil(event.nativeEvent.layout.width));
	return (
		<FieldShell spec={spec} error={error} labelHidden>
			<View
				style={[
					styles.hero,
					{
						borderColor: error ? colors.danger : focused ? colors.accent : colors.border,
						backgroundColor: focused ? colors.surface : colors.sunken,
					},
				]}
			>
				<Text
					style={styles.heroSymbol}
					tone="muted"
					accessibilityElementsHidden
					importantForAccessibility="no"
					allowFontScaling={false}
				>
					{spec.symbol}
				</Text>
				<TextInputMeasure text={text || placeholder} onLayout={sizer} />
				<TextFieldBare
					inputRef={inputRef}
					value={text}
					onChangeText={onChange}
					placeholder={placeholder}
					accessibilityLabel={name}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onSubmitEditing={onSubmit}
					style={[styles.heroInput, { width: Math.max(48, width + 6) }]}
				/>
			</View>
		</FieldShell>
	);
}

/** An invisible copy of the hero amount, measured to size the input to its text. */
function TextInputMeasure({
	text,
	onLayout,
}: { text: string; onLayout: (event: LayoutChangeEvent) => void }) {
	const styles = useStyles();
	return (
		<Text
			style={[styles.heroInput, styles.measure]}
			onLayout={onLayout}
			allowFontScaling={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			numberOfLines={1}
		>
			{text}
		</Text>
	);
}

/** A plain `TextInput` with the app's colors (the hero amount draws its own frame). */
function TextFieldBare({
	inputRef,
	style,
	decimal = true,
	...rest
}: {
	inputRef?: Ref<TextInput>;
	value: string;
	onChangeText(text: string): void;
	placeholder: string;
	accessibilityLabel: string;
	onFocus(): void;
	onBlur(): void;
	onSubmitEditing?(): void;
	/** Decimal keypad (default), or digits only. */
	decimal?: boolean;
	style: StyleProp<TextStyle>;
}) {
	const { colors } = useTheme();
	// TextField without its frame: same colors, decimal keypad, no font scaling past the box.
	return (
		<TextInput
			ref={inputRef}
			{...rest}
			keyboardType={decimal ? "decimal-pad" : "number-pad"}
			inputMode={decimal ? "decimal" : "numeric"}
			returnKeyType="done"
			allowFontScaling={false}
			placeholderTextColor={colors.textSubtle}
			selectionColor={colors.accent}
			cursorColor={colors.accent}
			style={style}
		/>
	);
}

// ── Numbers and durations ─────────────────────────────────────────────────

/** A number as typed in the locale ("12,5"), without grouping. */
function plain(n: number, locale: string): string {
	const text = String(Math.round(n * 1000) / 1000);
	return locale === "pt-BR" ? text.replace(".", ",") : text;
}

function QuickChips({
	items,
	onPick,
}: {
	items: { key: string; label: string; accessibilityLabel?: string }[];
	onPick(key: string): void;
}) {
	const styles = useStyles();
	if (!items.length) return null;
	return (
		<View style={styles.wrap}>
			{items.map((item) => (
				<SmallChip
					key={item.key}
					label={item.label}
					accessibilityLabel={item.accessibilityLabel}
					onPress={() => {
						haptics.selection();
						onPick(item.key);
					}}
				/>
			))}
		</View>
	);
}

function NumberInput(props: KindProps<"number">) {
	const { spec, value, onChange, error, inputRef, onSubmit } = props;
	const t = useT();
	const styles = useStyles();
	const text = asText(value);
	if (props.hero) return <HeroNumber {...props} />;
	const add = (amount: number) => {
		const current = parseDecimalInput(text) ?? 0;
		onChange(plain(Math.min(spec.max, Math.max(spec.min, current + amount)), t.locale));
	};
	return (
		<FieldShell spec={spec} error={error} labelHidden>
			<TextField
				ref={inputRef}
				value={text}
				onChangeText={onChange}
				placeholder={spec.placeholder}
				keyboardType={spec.decimals > 0 ? "decimal-pad" : "number-pad"}
				inputMode={spec.decimals > 0 ? "decimal" : "numeric"}
				returnKeyType="done"
				onSubmitEditing={onSubmit}
				error={error ? "" : null}
				accessibilityLabel={inputName(spec, t.t("common.optional"), spec.unit)}
				style={styles.tabular}
				right={
					spec.unit ? (
						<Text tone="muted" variant="small" style={styles.unit} numberOfLines={1}>
							{spec.unit}
						</Text>
					) : undefined
				}
			/>
			<QuickChips
				items={(spec.quick ?? []).map((amount) => ({
					key: String(amount),
					label: `+${t.number(amount)}`,
					accessibilityLabel: t.t("tracker.quickAdd", {
						amount: spec.unit ? `${t.number(amount)} ${spec.unit}` : t.number(amount),
						field: spec.label,
					}),
				}))}
				onPick={(key) => add(Number(key))}
			/>
		</FieldShell>
	);
}

/**
 * A number log's value, large and centred with the unit beside it ("72,4 kg"):
 * the number and the unit stay one group, sized to the text, like the
 * expense amount.
 */
function HeroNumber({ spec, value, onChange, error, inputRef, onSubmit }: KindProps<"number">) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [focused, setFocused] = useState(false);
	const [width, setWidth] = useState(0);
	const text = asText(value);
	const placeholder = spec.placeholder ?? "0";
	const add = (amount: number) => {
		const current = parseDecimalInput(text) ?? 0;
		onChange(plain(Math.min(spec.max, Math.max(spec.min, current + amount)), t.locale));
	};
	return (
		<FieldShell spec={spec} error={error} labelHidden>
			<View
				style={[
					styles.hero,
					{
						borderColor: error ? colors.danger : focused ? colors.accent : colors.border,
						backgroundColor: focused ? colors.surface : colors.sunken,
					},
				]}
			>
				<TextInputMeasure
					text={text || placeholder}
					onLayout={(event) => setWidth(Math.ceil(event.nativeEvent.layout.width))}
				/>
				<TextFieldBare
					inputRef={inputRef}
					value={text}
					onChangeText={onChange}
					placeholder={placeholder}
					decimal={spec.decimals > 0}
					accessibilityLabel={inputName(spec, t.t("common.optional"), spec.unit)}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onSubmitEditing={onSubmit}
					style={[styles.heroInput, { width: Math.max(40, width + 6) }]}
				/>
				{spec.unit ? (
					<Text
						tone="muted"
						style={styles.heroUnit}
						numberOfLines={1}
						accessibilityElementsHidden
						importantForAccessibility="no"
					>
						{spec.unit}
					</Text>
				) : null}
			</View>
			<QuickChips
				items={(spec.quick ?? []).map((amount) => ({
					key: String(amount),
					label: `+${t.number(amount)}`,
					accessibilityLabel: t.t("tracker.quickAdd", {
						amount: spec.unit ? `${t.number(amount)} ${spec.unit}` : t.number(amount),
						field: spec.label,
					}),
				}))}
				onPick={(key) => add(Number(key))}
			/>
		</FieldShell>
	);
}

/** Seconds as editable text: "25" (minutes), "4 min 30 s", "1:30" past an hour. */
function durationText(seconds: number): string {
	if (seconds % 60 === 0 && seconds < 3600) return String(seconds / 60);
	if (seconds % 60 === 0) {
		const h = Math.floor(seconds / 3600);
		const m = (seconds % 3600) / 60;
		return `${h}:${m < 10 ? `0${m}` : m}`;
	}
	const m = Math.floor(seconds / 60);
	return m > 0 ? `${m} min ${seconds % 60} s` : `${seconds} s`;
}

function DurationField({
	spec,
	value,
	onChange,
	error,
	inputRef,
	onSubmit,
}: KindProps<"duration">) {
	const t = useT();
	const styles = useStyles();
	const text = typeof value === "number" ? durationText(value) : asText(value);
	const minutesOnly = /^\s*\d+([.,]\d+)?\s*$/.test(text) || !text;
	const parsed = text ? parseDurationInput(text) : null;
	// Typed in another shape ("1:30", "45m"): say how it reads.
	const reading =
		parsed !== null && !minutesOnly && parsed > 0 ? t.formatDuration(parsed) : undefined;
	return (
		<FieldShell spec={spec} error={error} labelHidden>
			<TextField
				ref={inputRef}
				value={text}
				onChangeText={onChange}
				placeholder={t.t("tracker.durationPlaceholder")}
				keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
				returnKeyType="done"
				onSubmitEditing={onSubmit}
				error={error ? "" : null}
				accessibilityLabel={inputName(spec, t.t("common.optional"), t.t("tracker.minutesShort"))}
				style={styles.tabular}
				right={
					<Text
						tone="muted"
						variant="small"
						style={styles.unit}
						numberOfLines={1}
						accessibilityLiveRegion="polite"
					>
						{reading ?? (minutesOnly ? t.t("tracker.minutesShort") : "")}
					</Text>
				}
			/>
			<QuickChips
				items={(spec.quick ?? []).map((minutes) => ({
					key: String(minutes),
					label: t.formatDuration(minutes * 60),
				}))}
				onPick={(key) => onChange(Number(key) * 60)}
			/>
		</FieldShell>
	);
}

// ── Clock ─────────────────────────────────────────────────────────────────

function ClockField({ spec, value, onChange, error }: KindProps<"clock">) {
	const t = useT();
	const text = asText(value);
	const minutes = text ? parseClockInput(text) : null;
	const normalized =
		minutes !== null ? `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}` : null;
	const afterMidnight = spec.overnight && minutes !== null && minutes < 5 * 60;
	return (
		<FieldShell spec={spec} error={error} labelHidden>
			<TimeField
				value={normalized}
				onChange={(next) => onChange(next ?? "")}
				accessibilityLabel={inputName(spec, t.t("common.optional"))}
				minuteStep={1}
				clearable={!spec.required}
				defaultTime={spec.overnight ? "23:00" : "07:00"}
			/>
			{afterMidnight ? (
				<Text variant="small" tone="muted">
					{t.t("tracker.afterMidnight")}
				</Text>
			) : null}
		</FieldShell>
	);
}

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

// ── Choices ───────────────────────────────────────────────────────────────

interface RadioOption {
	value: string;
	label: string;
	emoji?: string;
	/** Spoken instead of the label. */
	accessibilityLabel?: string;
	icon?: ReactNode;
}

/**
 * Chips with radio semantics in a wrapping row, or a grid that keeps whole
 * words ("Subscriptions", "Assinaturas"). Optional groups clear when the
 * selected chip is pressed again.
 */
function RadioChips({
	options,
	value,
	onChange,
	label,
	layout = "chips",
	allowEmpty,
}: {
	options: readonly RadioOption[];
	value: string | null;
	onChange(value: string | null): void;
	/** Names the group for screen readers. */
	label: string;
	layout?: "chips" | "grid" | "row";
	allowEmpty?: boolean;
}) {
	const styles = useStyles();
	const [width, setWidth] = useState(0);
	const GAP = 8;
	// As many columns as fit cells of at least 140pt (two on phones).
	const columns =
		layout === "grid" ? Math.max(2, Math.floor((width + GAP) / (140 + GAP))) : options.length;
	const cellWidth =
		layout === "grid" && width > 0
			? Math.floor((width - GAP * (columns - 1)) / columns)
			: undefined;
	return (
		<View
			accessibilityRole="radiogroup"
			accessibilityLabel={label}
			onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
			style={layout === "row" ? styles.row5 : styles.wrap}
		>
			{options.map((option) => {
				const checked = option.value === value;
				return (
					<OptionChip
						key={option.value}
						option={option}
						checked={checked}
						layout={layout}
						width={layout === "grid" ? cellWidth : undefined}
						onPress={() => {
							haptics.selection();
							if (checked && allowEmpty) onChange(null);
							else onChange(option.value);
						}}
					/>
				);
			})}
		</View>
	);
}

function OptionChip({
	option,
	checked,
	layout,
	width,
	onPress,
}: {
	option: RadioOption;
	checked: boolean;
	layout: "chips" | "grid" | "row";
	width?: number;
	onPress(): void;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	const fg = checked ? colors.bg : colors.text;
	return (
		<PressableScale
			onPress={onPress}
			scaleTo={0.96}
			accessibilityRole="radio"
			accessibilityState={{ selected: checked, checked }}
			accessibilityLabel={option.accessibilityLabel ?? option.label}
			hitSlop={layout === "chips" ? 4 : 0}
			style={[
				layout === "grid" ? styles.gridCell : layout === "row" ? styles.rowCell : styles.chip,
				layout === "grid" && (width ? { width } : styles.gridFallback),
				{
					backgroundColor: checked ? colors.text : colors.surface,
					borderColor: checked ? colors.text : colors.border,
				},
			]}
		>
			{option.emoji ? (
				<Text style={styles.emoji} allowFontScaling={false}>
					{option.emoji}
				</Text>
			) : null}
			{option.icon}
			<Text
				variant="small"
				weight="medium"
				color={fg}
				numberOfLines={layout === "grid" ? 2 : 1}
				tabular={layout === "row"}
				style={layout === "grid" ? styles.gridLabel : undefined}
			>
				{option.label}
			</Text>
		</PressableScale>
	);
}

function ChoiceField({ spec, value, onChange, error }: KindProps<"choice">) {
	const t = useT();
	const { colors } = useTheme();
	const text = asText(value);
	const known = spec.options.some((o) => o.value === text);
	const [custom, setCustom] = useState(() => !!spec.custom && !!text && !known);
	const customOn = !!spec.custom && (custom || (!!text && !known));
	const CUSTOM = "__custom";
	const options: RadioOption[] = [
		...spec.options.map((option) => ({
			value: option.value,
			label: option.label,
			emoji: option.emoji,
		})),
		...(spec.custom
			? [
					{
						value: CUSTOM,
						label: t.t("tracker.custom"),
						icon: (
							<Plus size={14} color={customOn ? colors.bg : colors.textMuted} strokeWidth={2.4} />
						),
					},
				]
			: []),
	];
	return (
		<FieldShell spec={spec} error={error} labelHidden>
			<RadioChips
				label={inputName(spec, t.t("common.optional"))}
				layout={spec.layout}
				allowEmpty={!spec.required}
				value={customOn ? CUSTOM : text || null}
				options={options}
				onChange={(next) => {
					if (next === CUSTOM) {
						setCustom(true);
						if (known) onChange("");
						return;
					}
					setCustom(false);
					onChange(next ?? "");
				}}
			/>
			{customOn && spec.custom ? (
				<TextField
					value={known ? "" : text}
					onChangeText={onChange}
					maxLength={spec.custom.max}
					placeholder={spec.custom.placeholder}
					accessibilityLabel={`${spec.label}: ${t.t("tracker.custom")}`}
					autoFocus
					returnKeyType="done"
				/>
			) : null}
		</FieldShell>
	);
}

function RatingField({ spec, value, onChange, error }: KindProps<"rating">) {
	const t = useT();
	const styles = useStyles();
	const selected = typeof value === "number" ? value : null;
	const chosen = selected ? spec.labels[selected - 1] : null;
	return (
		<FieldShell spec={spec} error={error} labelHidden>
			<RadioChips
				label={inputName(spec, t.t("common.optional"))}
				layout="row"
				allowEmpty={!spec.required}
				value={selected ? String(selected) : null}
				onChange={(next) => onChange(next ? Number(next) : null)}
				options={spec.labels.map((label, index) => ({
					value: String(index + 1),
					label: t.number(index + 1),
					accessibilityLabel: `${index + 1} · ${label}`,
				}))}
			/>
			<View
				style={styles.ratingLegend}
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
			>
				<Text variant="tiny" tone="subtle" style={styles.legendSide} numberOfLines={2}>
					{spec.labels[0]}
				</Text>
				{chosen ? (
					<Text
						variant="tiny"
						weight="semibold"
						align="center"
						style={styles.legendMid}
						numberOfLines={2}
					>
						{chosen}
					</Text>
				) : null}
				<Text
					variant="tiny"
					tone="subtle"
					align="right"
					style={styles.legendSide}
					numberOfLines={2}
				>
					{spec.labels[spec.labels.length - 1]}
				</Text>
			</View>
		</FieldShell>
	);
}

function DayField({ spec, value, onChange, error }: KindProps<"day">) {
	const t = useT();
	return (
		<FieldShell spec={spec} error={error} labelHidden>
			<RadioChips
				label={inputName(spec, t.t("common.optional"))}
				value={asText(value) || null}
				onChange={(next) => onChange(next ?? "")}
				options={spec.options.map((option) => ({ value: option.value, label: option.label }))}
			/>
		</FieldShell>
	);
}

// ── Text ──────────────────────────────────────────────────────────────────

function TextInputField({ spec, value, onChange, error, inputRef, onSubmit }: KindProps<"text">) {
	const t = useT();
	const styles = useStyles();
	const text = asText(value);
	const [focused, setFocused] = useState(false);
	// Suggestions (recent notes, people, books…): the ones that fit what's typed, best first.
	const matches = useMemo(() => {
		const all = spec.suggestions ?? [];
		const typed = foldText(text.trim());
		if (!typed) return all.slice(0, 8);
		const starts: string[] = [];
		const contains: string[] = [];
		for (const s of all) {
			const folded = foldText(s);
			if (folded === typed) continue;
			if (folded.startsWith(typed)) starts.push(s);
			else if (folded.includes(typed)) contains.push(s);
		}
		return [...starts, ...contains].slice(0, 8);
	}, [spec.suggestions, text]);
	return (
		<FieldShell spec={spec} error={error} labelHidden>
			<TextField
				ref={inputRef}
				value={text}
				onChangeText={onChange}
				maxLength={spec.max}
				placeholder={spec.placeholder}
				returnKeyType="done"
				onSubmitEditing={onSubmit}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				error={error ? "" : null}
				accessibilityLabel={inputName(spec, t.t("common.optional"))}
			/>
			{matches.length && (focused || !text) ? (
				<ScrollView
					horizontal
					keyboardShouldPersistTaps="always"
					showsHorizontalScrollIndicator={false}
					contentContainerStyle={styles.suggestions}
					accessibilityLabel={spec.label}
				>
					{matches.map((suggestion) => (
						<SmallChip
							key={suggestion}
							label={suggestion}
							onPress={() => {
								haptics.selection();
								onChange(suggestion);
							}}
						/>
					))}
				</ScrollView>
			) : null}
		</FieldShell>
	);
}

function LongTextField({ spec, value, onChange, error }: KindProps<"longtext">) {
	const t = useT();
	return (
		<FieldShell spec={spec} error={error} labelHidden>
			<Textarea
				value={asText(value)}
				onChangeText={onChange}
				maxLength={spec.max}
				placeholder={spec.placeholder}
				minRows={2}
				maxRows={8}
				counter
				error={error ? "" : null}
				accessibilityLabel={inputName(spec, t.t("common.optional"))}
			/>
		</FieldShell>
	);
}

function LinesField({ spec, value, onChange, error, inputRef, onSubmit }: KindProps<"lines">) {
	const t = useT();
	const styles = useStyles();
	const refs = useRef<(TextInput | null)[]>([]);
	const [focusNext, setFocusNext] = useState<number | null>(null);
	const lines = Array.isArray(value) ? (value as string[]) : [];
	const rows = Math.max(spec.rows ?? spec.min, lines.length, 1);
	const shown = Array.from({ length: Math.min(spec.max, rows) }, (_, i) => lines[i] ?? "");
	const set = (index: number, text: string) => {
		const next = [...shown];
		next[index] = text;
		onChange(next);
	};
	// "Add a line" puts the cursor in it once it's there.
	useEffect(() => {
		if (focusNext === null) return;
		refs.current[focusNext]?.focus();
		setFocusNext(null);
	}, [focusNext]);
	return (
		<FieldShell spec={spec} error={error}>
			{shown.map((line, index) => {
				const last = index === shown.length - 1;
				return (
					<View
						// biome-ignore lint/suspicious/noArrayIndexKey: numbered input lines.
						key={index}
						style={styles.lineRow}
					>
						<Text
							variant="small"
							tone="subtle"
							tabular
							style={styles.lineNumber}
							accessibilityElementsHidden
							importantForAccessibility="no"
						>
							{index + 1}
						</Text>
						<TextField
							ref={(input) => {
								refs.current[index] = input;
								if (index === 0) assignRef(inputRef, input);
							}}
							value={line}
							onChangeText={(text) => set(index, text)}
							maxLength={spec.itemMax}
							placeholder={index === 0 ? spec.placeholder : undefined}
							accessibilityLabel={`${spec.label} ${index + 1}`}
							containerStyle={styles.grow}
							autoCapitalize="sentences"
							// Return goes on to the next line, the way a list is written; the last one saves.
							returnKeyType={last ? "done" : "next"}
							submitBehavior={last ? "blurAndSubmit" : "submit"}
							onSubmitEditing={() => {
								if (last) onSubmit?.();
								else refs.current[index + 1]?.focus();
							}}
						/>
					</View>
				);
			})}
			{shown.length < spec.max ? (
				<SmallChip
					label={t.t("tracker.addLine")}
					icon
					onPress={() => {
						onChange([...shown, ""]);
						setFocusNext(shown.length);
					}}
					style={styles.addLine}
				/>
			) : null}
		</FieldShell>
	);
}

/** Hands an element to a callback or object ref. */
function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
	if (typeof ref === "function") ref(value);
	else if (ref && typeof ref === "object") (ref as { current: T | null }).current = value;
}

// ── Book and photos ───────────────────────────────────────────────────────

function BookField({ spec, value, onChange, error, books = [], onNewBook }: KindProps<"book">) {
	const t = useT();
	const { colors } = useTheme();
	const selected = typeof value === "string" ? value : "";
	const options = books.filter((b) => b.status !== "abandoned" || b.id === selected);
	const missing = selected && !books.some((b) => b.id === selected);
	const NONE = "__none";
	const items: RadioOption[] = [
		...options.map((book) => ({
			value: book.id,
			label:
				book.status === "reading"
					? book.title
					: `${book.title} · ${t.t(`tracker.bookStatus.${book.status}`)}`,
			emoji: book.status === "reading" ? "📖" : undefined,
		})),
		...(missing ? [{ value: selected, label: t.t("tracker.reading.deletedBook") }] : []),
		{ value: NONE, label: t.t("tracker.reading.noBook") },
	];
	return (
		<FieldShell spec={spec} error={error} labelHidden>
			<RadioChips
				label={inputName(spec, t.t("common.optional"))}
				value={selected || NONE}
				onChange={(next) => onChange(!next || next === NONE ? null : next)}
				options={items}
			/>
			{onNewBook ? (
				<SmallChip
					label={t.t("tracker.reading.newBook")}
					icon
					color={colors.accentText}
					onPress={onNewBook}
					style={{ alignSelf: "flex-start" }}
				/>
			) : null}
		</FieldShell>
	);
}

function PhotosField({ spec, value, onChange, error, day, onBusyChange }: KindProps<"photos">) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	// No photo store here (a web preview without the QA switch): say so instead of a picker.
	if (!trackerCaps().photos) {
		return (
			<View style={styles.field}>
				<FieldLabel spec={spec} />
				<View style={styles.notice}>
					<ImageOff size={16} color={colors.textMuted} />
					<Text variant="small" tone="muted" style={styles.grow}>
						{t.t("tracker.photosOff")}
					</Text>
				</View>
			</View>
		);
	}
	const photos = Array.isArray(value) ? (value as AttachmentRef[]) : [];
	return (
		<FieldShell spec={spec} error={error}>
			<PhotoPicker
				value={photos}
				onChange={onChange}
				max={spec.max}
				day={day}
				invalid={!!error}
				onBusyChange={onBusyChange}
			/>
		</FieldShell>
	);
}

// ── Small chips ───────────────────────────────────────────────────────────

/** A quiet pill for quick picks and suggestions ("+10", "Lunch", "+ Add a line"). */
export function SmallChip({
	label,
	onPress,
	icon,
	color,
	accessibilityLabel,
	style,
}: {
	label: string;
	onPress(): void;
	/** A leading "+". */
	icon?: boolean;
	color?: string;
	accessibilityLabel?: string;
	style?: object;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<PressableScale
			onPress={onPress}
			scaleTo={0.95}
			hitSlop={6}
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel ?? label}
			style={[styles.smallChip, style]}
		>
			{icon ? <Plus size={15} color={color ?? colors.textMuted} strokeWidth={2.2} /> : null}
			<Text
				variant="small"
				weight="medium"
				color={color ?? colors.textMuted}
				numberOfLines={1}
				tabular
			>
				{label}
			</Text>
		</PressableScale>
	);
}

const useStyles = makeStyles((t) => ({
	field: { gap: 8 },
	labelRow: {
		flexDirection: "row",
		alignItems: "baseline",
		justifyContent: "space-between",
		gap: 8,
	},
	labelText: { flexShrink: 1 },
	tabular: { fontVariant: ["tabular-nums"] },
	unit: { marginLeft: 8, maxWidth: 140 },
	wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	row5: { flexDirection: "row", gap: 6 },
	chip: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		minHeight: 40,
		maxWidth: "100%",
		paddingHorizontal: 14,
		borderRadius: 999,
		borderWidth: 1,
	},
	gridCell: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		minHeight: 46,
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: t.radii.md,
		borderWidth: 1,
	},
	gridFallback: { flexBasis: "46%", flexGrow: 1 },
	gridLabel: { flexShrink: 1 },
	rowCell: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		height: 44,
		borderRadius: t.radii.md,
		borderWidth: 1,
	},
	emoji: { fontSize: 16, lineHeight: 20 },
	ratingLegend: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
	legendSide: { flex: 1 },
	legendMid: { flex: 1.2 },
	hero: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		minHeight: 88,
		paddingHorizontal: 16,
		borderRadius: t.radii.lg,
		borderWidth: 1.5,
		gap: 6,
		overflow: "hidden",
	},
	heroSymbol: { fontFamily: fonts.serif, fontSize: 30, lineHeight: 38 },
	heroUnit: { fontSize: 18, lineHeight: 24, marginTop: 10, flexShrink: 1, maxWidth: 140 },
	heroInput: {
		fontFamily: fonts.serif,
		fontSize: 46,
		lineHeight: 56,
		color: t.colors.text,
		paddingVertical: 8,
		textAlign: "center",
		fontVariant: ["tabular-nums"],
		outlineWidth: 0,
		maxWidth: 260,
	},
	measure: { position: "absolute", opacity: 0, left: 0, top: 0 },
	suggestions: { flexDirection: "row", gap: 8, paddingRight: 8 },
	lineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
	lineNumber: { width: 14, textAlign: "right" },
	grow: { flex: 1 },
	addLine: { alignSelf: "flex-start", marginLeft: 24 },
	notice: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	smallChip: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
		height: 34,
		paddingHorizontal: 12,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
}));
