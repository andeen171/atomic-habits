import {
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	CircleCheck,
	EyeOff,
	Feather,
	Info,
	ListPlus,
	Lock,
	type LucideIcon,
	Mountain,
	Share2,
	Signature,
	Target,
	TrendingDown,
	TrendingUp,
} from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatTile } from "@/components/ui/stat-tile";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { TimeField } from "@/components/ui/time-field";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { haptics } from "@/lib/haptics";
import { type AppTranslator, useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	CHECKIN_DIFFICULTIES,
	CONTRACT_LENGTHS,
	CUE_TYPES,
	type CheckinDifficulty,
	type DayKey,
	type Habit,
	type HabitColor,
	type JournalBlock,
	type JournalContract,
	type JournalKind,
	type JournalPrompt,
	type JournalRange,
	type MessageKey,
	type ReviewScope,
	SCORECARD_RATINGS,
	type ScorecardRating,
	type Weekday,
	addDays,
	addMonths,
	applyRecoveryPlan,
	capitalize,
	contractStatus,
	contractText,
	habitPatchFromRecovery,
	intentionSentence,
	isSameMonth,
	journalAnyOf,
	journalBlocks,
	journalExampleKey,
	journalHintKey,
	journalPromptKey,
	journalTaskInput,
	monthGrid,
	onScorecard,
	orderedWeekdays,
	rangeLabel,
	reviewRange,
	reviewScopeOf,
	shiftReviewRange,
	startOfMonth,
	toDayKey,
} from "@atomic/core";
import {
	type JournalEditorState,
	useActions,
	useAtomic,
	useAtomicStore,
	useGoldilocks,
	useIdentities,
	useReviewSnapshot,
	useScorecard,
	useText,
	useToday,
} from "@atomic/core/react";
import { router } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, Share, type TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

/** What every block reads: the editor, the kind and the linked habit. */
export interface JournalBlockContext {
	editor: JournalEditorState;
	kind: JournalKind;
	/** The linked habit's record (it may be archived or deleted since). */
	habit: Habit | undefined;
	/** The same habit with its name and unit in the content language, for copy only. */
	shown: Habit | undefined;
	/** A signed contract: its terms are read-only until the signature is revoked. */
	locked: boolean;
	/** The entry's stored id once it exists (side actions that need it). */
	entryId: string | null;
	/** Prompts register their input so Sign can bring the first missing one into view. */
	registerField(id: string, input: TextInput | null): void;
	/** Scrolls to a prompt and focuses it. */
	focusField(id: string): void;
}

const filled = (value: string | null | undefined): value is string => !!value?.trim();

const announce = (message: string) => AccessibilityInfo.announceForAccessibility(message);

/** "10 pages" / "10": a target with the habit's unit. */
function amount(habit: Habit, value: number, t: AppTranslator): string {
	return habit.unit ? `${t.number(value)} ${habit.unit}` : t.number(value);
}

/** A toast with Undo; the habit's name rides along when the action changed a habit. */
function undoToast(t: AppTranslator, message: string, undo: () => void, detail?: string) {
	showToast(detail ? `${message} · ${detail}` : message, {
		tone: "success",
		action: { label: t.t("common.undo"), onPress: undo },
	});
}

// ── Shared pieces ──

function RequiredTag() {
	const t = useT();
	const styles = useStyles();
	return (
		<View style={styles.requiredTag}>
			<Text variant="tiny" weight="semibold" tone="muted">
				{t.t("journal.required")}
			</Text>
		</View>
	);
}

/**
 * A block's question line. For prompts the input carries the same words as
 * its label, so the visible line is hidden from screen readers.
 */
function Question({
	children,
	required,
	hidden,
}: {
	children: string;
	/** Shows "Required" while unanswered. */
	required?: boolean;
	hidden?: boolean;
}) {
	const styles = useStyles();
	return (
		<View
			style={styles.questionRow}
			accessibilityElementsHidden={hidden}
			importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
		>
			<Text variant="h3" style={styles.question} accessibilityRole={hidden ? undefined : "header"}>
				{children}
			</Text>
			{required ? <RequiredTag /> : null}
		</View>
	);
}

/** Speaks "N characters left" when an answer crosses 80%, 90% and 100% of its limit. */
function useLimitAnnouncements(length: number, max: number) {
	const t = useT();
	const bucket = length >= max ? 3 : length >= max * 0.9 ? 2 : length > max * 0.8 ? 1 : 0;
	const previous = useRef(bucket);
	useEffect(() => {
		if (bucket > previous.current) announce(t.tp("journal.charsLeft", Math.max(0, max - length)));
		previous.current = bucket;
	}, [bucket, length, max, t]);
}

/** A signed contract's terms: text on the page, not a field to fill. */
function LockedAnswer({ question, value }: { question: string; value: string }) {
	const styles = useStyles();
	return (
		<View style={styles.locked} accessible accessibilityLabel={`${question}: ${value}`}>
			<Text style={styles.lockedText}>{value}</Text>
		</View>
	);
}

// ── Prompts ──

function PromptBlock({ ctx, prompt }: { ctx: JournalBlockContext; prompt: JournalPrompt }) {
	const t = useT();
	const styles = useStyles();
	const { editor, kind, shown, locked } = ctx;
	const value = editor.draft.answers[prompt.id] ?? "";
	const missing = prompt.required && !value.trim();
	const counted = prompt.input !== "time";
	const showCount = counted && value.length > prompt.maxLength * 0.8;
	useLimitAnnouncements(counted ? value.length : 0, prompt.maxLength);

	const question = t.t(journalPromptKey(kind, prompt.id), { habit: shown?.name ?? "" });
	const hint = prompt.hasHint ? t.t(journalHintKey(kind, prompt.id)) : null;
	const placeholder = prompt.hasExample ? t.t(journalExampleKey(kind, prompt.id)) : undefined;
	const a11yHint = [missing ? t.t("journal.required") : null, hint].filter(Boolean).join(". ");
	const set = (next: string) => editor.setAnswer(prompt.id, next);
	const register = (input: TextInput | null) => ctx.registerField(prompt.id, input);

	let control: ReactNode;
	if (locked && counted) {
		control = <LockedAnswer question={question} value={value} />;
	} else if (prompt.input === "time") {
		control = (
			<TimeField
				value={value || null}
				onChange={(next) => set(next ?? "")}
				accessibilityLabel={question}
				disabled={locked}
				style={styles.timeField}
				testID={`journal-field-${prompt.id}`}
			/>
		);
	} else if (prompt.input === "line") {
		control = (
			<TextField
				ref={register}
				value={value}
				onChangeText={set}
				maxLength={prompt.maxLength}
				placeholder={placeholder}
				accessibilityLabel={question}
				accessibilityHint={a11yHint || undefined}
				returnKeyType="done"
				testID={`journal-field-${prompt.id}`}
			/>
		);
	} else {
		const long = prompt.maxLength >= 2000;
		control = (
			<Textarea
				ref={register}
				value={value}
				onChangeText={set}
				maxLength={prompt.maxLength}
				minRows={long ? 3 : 2}
				maxRows={long ? 14 : 8}
				placeholder={placeholder}
				accessibilityLabel={question}
				accessibilityHint={a11yHint || undefined}
				testID={`journal-field-${prompt.id}`}
			/>
		);
	}

	return (
		<View style={styles.prompt}>
			<Question required={missing} hidden={!locked}>
				{question}
			</Question>
			{hint ? (
				<Text
					variant="small"
					tone="muted"
					style={styles.hint}
					accessibilityElementsHidden={!locked}
					importantForAccessibility={locked ? "auto" : "no-hide-descendants"}
				>
					{hint}
				</Text>
			) : null}
			{control}
			{showCount ? (
				<Text
					variant="tiny"
					tone={value.length >= prompt.maxLength ? "danger" : "subtle"}
					align="right"
					tabular
					style={styles.counter}
				>
					{t.t("journal.counter", {
						count: t.number(value.length),
						max: t.number(prompt.maxLength),
					})}
				</Text>
			) : null}
		</View>
	);
}

// ── Single choices (rating, difficulty, cue) ──

interface ChoiceOption<T extends string> {
	value: T;
	label: string;
	leading?: ReactNode;
}

/**
 * Pills with radio semantics that wrap long labels (pt-BR cue types run
 * long). Nothing is selected at first; with `allowEmpty`, tapping the
 * selected pill clears it.
 */
function ChoiceGroup<T extends string>({
	label,
	value,
	options,
	onChange,
	allowEmpty,
	disabled,
	testID,
}: {
	label: string;
	value: T | null;
	options: readonly ChoiceOption<T>[];
	onChange(value: T | null): void;
	allowEmpty?: boolean;
	disabled?: boolean;
	testID?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<PressableScale
						key={option.value}
						testID={testID ? `${testID}-${option.value}` : undefined}
						scaleTo={0.96}
						disabled={disabled}
						hitSlop={4}
						onPress={() => {
							haptics.selection();
							if (selected) {
								if (allowEmpty) onChange(null);
								return;
							}
							onChange(option.value);
						}}
						accessibilityRole="radio"
						accessibilityLabel={option.label}
						accessibilityState={{ selected, disabled: Boolean(disabled) }}
						style={[
							styles.choice,
							option.leading ? styles.choiceLeading : null,
							selected
								? { backgroundColor: colors.text, borderColor: colors.text }
								: { backgroundColor: colors.surface, borderColor: colors.border },
							disabled && { opacity: 0.55 },
						]}
					>
						{option.leading}
						<Text
							variant="small"
							weight={selected ? "semibold" : "medium"}
							color={selected ? colors.bg : colors.text}
							style={styles.choiceText}
						>
							{option.label}
						</Text>
					</PressableScale>
				);
			})}
		</View>
	);
}

export const RATING_SYMBOL: Record<ScorecardRating, string> = {
	positive: "+",
	neutral: "=",
	negative: "−",
};

/** Solid tone discs (as on the Scorecard): the glyph reads in both themes, the label carries the meaning. */
export function RatingDisc({ rating, size = 24 }: { rating: ScorecardRating; size?: number }) {
	const { colors, onStatus } = useTheme();
	const styles = useStyles();
	const bg =
		rating === "positive" ? colors.success : rating === "negative" ? colors.danger : colors.sunken;
	const fg =
		rating === "positive"
			? onStatus.success
			: rating === "negative"
				? onStatus.danger
				: colors.textMuted;
	return (
		<View
			style={[
				styles.disc,
				{ backgroundColor: bg, width: size, height: size, borderRadius: size / 2 },
				rating === "neutral" && { borderWidth: 1, borderColor: colors.borderStrong },
			]}
		>
			<Text
				weight="bold"
				color={fg}
				style={[
					styles.discGlyph,
					size < 24 && { fontSize: Math.round(size * 0.62), lineHeight: size - 2 },
				]}
				allowFontScaling={false}
			>
				{RATING_SYMBOL[rating]}
			</Text>
		</View>
	);
}

function RatingBlock({ ctx }: { ctx: JournalBlockContext }) {
	const t = useT();
	const styles = useStyles();
	const { editor, kind } = ctx;
	const question = t.t(journalPromptKey(kind, "rating"));
	return (
		<View style={styles.blockGap}>
			<Question required={editor.draft.rating == null}>{question}</Question>
			<ChoiceGroup<ScorecardRating>
				label={question}
				testID="journal-rating"
				value={editor.draft.rating}
				onChange={(rating) => {
					if (rating) editor.update({ rating });
				}}
				options={SCORECARD_RATINGS.map((rating) => ({
					value: rating,
					label: t.t(`journal.rating.${rating}`),
					leading: <RatingDisc rating={rating} />,
				}))}
			/>
		</View>
	);
}

export const DIFFICULTY_ICON: Record<CheckinDifficulty, LucideIcon> = {
	"too-easy": Feather,
	"just-right": Target,
	"too-hard": Mountain,
};

function DifficultyBlock({ ctx }: { ctx: JournalBlockContext }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const { editor, kind, shown } = ctx;
	const question = t.t(journalPromptKey(kind, "difficulty"), { habit: shown?.name ?? "" });
	const value = editor.draft.difficulty;
	return (
		<View style={styles.blockGap}>
			<Question required={value == null}>{question}</Question>
			<ChoiceGroup<CheckinDifficulty>
				label={question}
				testID="journal-difficulty"
				value={value}
				onChange={(difficulty) => {
					if (difficulty) editor.update({ difficulty });
				}}
				options={CHECKIN_DIFFICULTIES.map((difficulty) => {
					const Icon = DIFFICULTY_ICON[difficulty];
					return {
						value: difficulty,
						label: t.t(`journal.difficulty.${difficulty}`),
						leading: (
							<Icon
								size={17}
								color={difficulty === value ? colors.bg : colors.text}
								strokeWidth={2}
							/>
						),
					};
				})}
			/>
		</View>
	);
}

function CueTypeBlock({ ctx }: { ctx: JournalBlockContext }) {
	const t = useT();
	const styles = useStyles();
	const { editor, kind } = ctx;
	const question = t.t(journalPromptKey(kind, "cueType"));
	const value = editor.draft.answers.cueType ?? "";
	return (
		<View style={styles.blockGap}>
			<Question>{question}</Question>
			<ChoiceGroup<string>
				label={question}
				testID="journal-cue"
				allowEmpty
				value={(CUE_TYPES as readonly string[]).includes(value) ? value : null}
				onChange={(next) => editor.setAnswer("cueType", next ?? "")}
				options={CUE_TYPES.map((cue) => ({ value: cue, label: t.t(`cue.${cue}`) }))}
			/>
		</View>
	);
}

// ── The plan (recovery) ──

/** "Your plan": the live intention sentence (build) or the hide/friction lines (break), and "Make this the habit's plan". */
function PlanBlock({ ctx }: { ctx: JournalBlockContext }) {
	const t = useT();
	const text = useText();
	const store = useAtomicStore();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const { editor, kind, habit, shown } = ctx;
	if (!habit || !shown) return null;
	const tone = toneOf(habit.color);
	const answers = editor.draft.answers;
	const live = !habit.deletedAt && !habit.archivedAt;
	const isBreak = habit.kind === "break";
	const sentence = isBreak ? null : intentionSentence(shown, answers, t);
	const lines = isBreak
		? [
				{ key: "hide", icon: EyeOff, text: answers.hide },
				{ key: "friction", icon: Lock, text: answers.friction },
			].filter((line) => filled(line.text))
		: [];
	const patch = live ? habitPatchFromRecovery(habit, answers) : null;
	const anyAnswered = journalAnyOf(kind, habit).some((id) => filled(answers[id]));

	const apply = () => {
		const undo = applyRecoveryPlan(store, habit.id, answers);
		if (!undo) return;
		haptics.success();
		undoToast(t, t.t("journal.habitUpdated"), undo, text.habit(habit, "name"));
	};

	return (
		<View
			style={[styles.softCard, { backgroundColor: tone.softer }]}
			testID="journal-plan"
			accessibilityLiveRegion="polite"
		>
			<Text variant="label" accessibilityRole="header">
				{t.t("journal.recovery.yourPlan")}
			</Text>
			{isBreak ? (
				lines.length ? (
					<View style={styles.planLines}>
						{lines.map((line) => {
							const Icon = line.icon;
							return (
								<View key={line.key} style={styles.planLine}>
									<Icon size={16} color={tone.text} strokeWidth={2} style={styles.planIcon} />
									<Text style={styles.grow}>{line.text}</Text>
								</View>
							);
						})}
					</View>
				) : (
					<Text variant="small" tone="muted" style={styles.planEmpty}>
						{t.t("journal.anyOf")}
					</Text>
				)
			) : sentence ? (
				<Text variant="display" style={styles.planSentence}>
					{sentence}
				</Text>
			) : (
				<Text variant="small" tone="muted" style={styles.planEmpty}>
					{t.t("journal.plan.empty")}
				</Text>
			)}
			{live && anyAnswered ? (
				<View style={styles.cardAction}>
					{patch ? (
						<Button
							label={t.t("journal.applyToHabit")}
							variant="secondary"
							size="sm"
							onPress={apply}
							style={styles.alignStart}
							testID="journal-apply-plan"
						/>
					) : (
						<View style={styles.doneLine}>
							<Text variant="small" weight="semibold" tone="success" style={styles.grow}>
								{t.t("journal.plan.isHabitPlan")}
							</Text>
						</View>
					)}
				</View>
			) : null}
		</View>
	);
}

// ── Goldilocks (check-in) ──

function GoldilocksBlock({ ctx }: { ctx: JournalBlockContext }) {
	const t = useT();
	const text = useText();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const { editor, habit, shown } = ctx;
	const live = habit && !habit.deletedAt ? habit : undefined;
	const difficulty = editor.draft.difficulty;
	const { suggestion, apply } = useGoldilocks(live, difficulty);
	const [applied, setApplied] = useState<{ difficulty: CheckinDifficulty; target: number } | null>(
		null,
	);
	if (!difficulty || !habit || !shown) return null;
	const tone = toneOf(habit.color);
	const usable = !!live && !live.archivedAt;
	const done =
		applied && applied.difficulty === difficulty && live?.target === applied.target
			? applied.target
			: null;

	const onApply = () => {
		if (!suggestion || suggestion.type !== "target") return;
		const undo = apply();
		if (!undo) return;
		haptics.success();
		setApplied({ difficulty, target: suggestion.target });
		undoToast(
			t,
			t.t("journal.goldilocks.applied"),
			() => {
				undo();
				setApplied(null);
			},
			text.habit(habit, "name"),
		);
	};

	let body: ReactNode;
	let action: ReactNode = null;
	if (difficulty === "just-right") {
		body = <Text>{t.t("journal.goldilocks.right")}</Text>;
	} else if (difficulty === "too-easy") {
		body = (
			<>
				<Text>{t.t("journal.goldilocks.easy")}</Text>
				{suggestion ? null : (
					<Text tone="muted" style={styles.tip}>
						{t.t("journal.goldilocks.easyTip")}
					</Text>
				)}
			</>
		);
	} else if (suggestion?.type === "twoMinute") {
		body = (
			<Text>
				{suggestion.twoMinute
					? t.t("journal.goldilocks.useTwoMinute", { twoMinute: suggestion.twoMinute })
					: t.t("journal.goldilocks.hard")}
			</Text>
		);
		if (!suggestion.twoMinute && usable) {
			action = (
				<Button
					label={t.t("journal.goldilocks.defineTwoMinute")}
					variant="secondary"
					size="sm"
					onPress={() => router.push({ pathname: "/habit/editor", params: { id: habit.id } })}
					style={styles.alignStart}
				/>
			);
		}
	} else {
		body = <Text>{t.t("journal.goldilocks.hard")}</Text>;
	}
	if (suggestion?.type === "target" && usable) {
		const raise = difficulty === "too-easy";
		action = done ? (
			<View style={styles.doneLine}>
				<Text variant="small" weight="semibold" tone="success" style={styles.grow}>
					{t.t("journal.goldilocks.now", { target: amount(shown, done, t) })}
				</Text>
			</View>
		) : (
			<Button
				label={t.t(raise ? "journal.goldilocks.raise" : "journal.goldilocks.lower", {
					target: amount(shown, suggestion.target, t),
				})}
				icon={raise ? TrendingUp : TrendingDown}
				variant="secondary"
				size="sm"
				onPress={onApply}
				style={styles.alignStart}
				testID="journal-goldilocks-apply"
			/>
		);
	}

	return (
		<Animated.View
			key={difficulty}
			entering={reduceMotion ? undefined : FadeIn.duration(220)}
			style={[styles.softCard, { backgroundColor: tone.softer }]}
			accessibilityLiveRegion="polite"
			testID="journal-goldilocks"
		>
			{body}
			{action ? <View style={styles.cardAction}>{action}</View> : null}
		</Animated.View>
	);
}

// ── Day picker (entry date, contract end) ──

/** A month calendar in a sheet, limited to [min, max]. */
export function JournalDaySheet({
	open,
	title,
	value,
	min,
	max,
	onPick,
	onClose,
}: {
	open: boolean;
	title: string;
	value: DayKey;
	min?: DayKey;
	max?: DayKey;
	onPick(day: DayKey): void;
	onClose(): void;
}) {
	const t = useT();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn) as Weekday;
	const [month, setMonth] = useState(() => startOfMonth(value));
	// Each opening starts on the chosen day's month.
	useEffect(() => {
		if (open) setMonth(startOfMonth(value));
	}, [open, value]);
	const out = (day: DayKey) => (min !== undefined && day < min) || (max !== undefined && day > max);
	const canPrev = min === undefined || addDays(month, -1) >= min;
	const canNext = max === undefined || addMonths(month, 1) <= max;
	return (
		<Sheet open={open} onClose={onClose} title={title} testID="journal-day-sheet">
			<View style={styles.calHeader}>
				<Text variant="h3" style={styles.grow} accessibilityLiveRegion="polite">
					{capitalize(t.formatMonth(month))}
				</Text>
				<IconButton
					icon={ChevronLeft}
					size={34}
					iconSize={18}
					variant="soft"
					color={colors.textMuted}
					disabled={!canPrev}
					accessibilityLabel={t.x("a11y.prevMonth")}
					onPress={() => setMonth(addMonths(month, -1))}
				/>
				<IconButton
					icon={ChevronRight}
					size={34}
					iconSize={18}
					variant="soft"
					color={colors.textMuted}
					disabled={!canNext}
					accessibilityLabel={t.x("a11y.nextMonth")}
					onPress={() => setMonth(addMonths(month, 1))}
				/>
			</View>
			<View style={styles.calWeek}>
				{orderedWeekdays(weekStartsOn).map((d) => (
					<Text
						key={d}
						variant="tiny"
						weight="semibold"
						tone="subtle"
						align="center"
						style={styles.calCell}
						accessibilityElementsHidden
						importantForAccessibility="no"
					>
						{t.weekdayName(d, "min")}
					</Text>
				))}
			</View>
			{monthGrid(month, weekStartsOn).map((row) => (
				<View key={row[0]} style={styles.calWeek}>
					{row.map((day) => {
						const selected = day === value;
						const disabled = out(day);
						const isToday = day === today;
						return (
							<View key={day} style={styles.calCell}>
								<Pressable
									disabled={disabled}
									hitSlop={2}
									onPress={() => {
										haptics.selection();
										onPick(day);
									}}
									accessibilityRole="button"
									accessibilityLabel={t.formatDayLong(day)}
									accessibilityState={{ selected, disabled }}
									style={[
										styles.calDay,
										selected && { backgroundColor: colors.text },
										!selected && isToday && { borderColor: colors.accent, borderWidth: 1.5 },
										disabled && { opacity: 0.3 },
									]}
								>
									<Text
										variant="small"
										weight={selected || isToday ? "semibold" : "regular"}
										tabular
										color={selected ? colors.bg : isToday ? colors.accentText : undefined}
										tone={isSameMonth(day, month) ? "default" : "subtle"}
									>
										{Number(day.slice(8))}
									</Text>
								</Pressable>
							</View>
						);
					})}
				</View>
			))}
		</Sheet>
	);
}

// ── Habit contract ──

const STATUS_TONE = {
	draft: "sunken",
	active: "success",
	ended: "warning",
	kept: "success",
	broken: "danger",
} as const;

export function ContractStatusBadge({
	status,
	until,
	size = "md",
}: {
	status: keyof typeof STATUS_TONE;
	until: DayKey;
	/** `sm`: the pill size of journal cards. */
	size?: "sm" | "md";
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const tone = STATUS_TONE[status];
	const bg =
		tone === "sunken"
			? colors.sunken
			: tone === "success"
				? colors.successSoft
				: tone === "warning"
					? colors.warningSoft
					: colors.dangerSoft;
	const fg =
		tone === "sunken"
			? colors.textMuted
			: tone === "success"
				? colors.success
				: tone === "warning"
					? colors.warning
					: colors.danger;
	const label =
		status === "active"
			? t.t("journal.contract.active", { date: t.formatDayShort(until) })
			: t.t(`journal.contract.${status}` as MessageKey);
	return (
		<View style={[styles.badge, size === "sm" && styles.badgeSm, { backgroundColor: bg }]}>
			{status === "kept" || status === "active" ? (
				<CircleCheck size={size === "sm" ? 12 : 13} color={fg} strokeWidth={2.2} />
			) : null}
			<Text variant="tiny" weight="semibold" color={fg}>
				{label}
			</Text>
		</View>
	);
}

async function shareContract(title: string, message: string, t: AppTranslator) {
	try {
		await Share.share({ title, message });
	} catch {
		// Browsers without the share sheet (the web preview): copy the text instead.
		const clipboard = Platform.OS === "web" ? globalThis.navigator?.clipboard : undefined;
		if (!clipboard) return;
		try {
			await clipboard.writeText(message);
			showToast(t.t("journal.contract.copied"));
		} catch {
			// Nothing else to fall back to.
		}
	}
}

function ContractBlock({ ctx }: { ctx: JournalBlockContext }) {
	const t = useT();
	const actions = useActions();
	const store = useAtomicStore();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const displayName = useAtomic((s) => s.settings.displayName);
	const [picking, setPicking] = useState(false);
	const { editor, habit, locked, entryId } = ctx;
	const { draft, check } = editor;
	const start = draft.date;
	const contract: JournalContract = draft.contract ?? {
		until: addDays(start, 29),
		partner: null,
		signedAt: null,
		outcome: null,
	};
	const status = contractStatus(draft, today);
	const signed = contract.signedAt != null;
	const name = displayName.trim();
	const signedLine = t.t("journal.contract.signed", {
		date: t.formatDayShort(toDayKey(contract.signedAt ?? Date.now())),
	});
	const untilLabel = t.t("journal.contract.until");

	const setTerms = (patch: Partial<JournalContract>) =>
		editor.update({ contract: { ...contract, ...patch } });

	const sign = () => {
		if (!check.complete) {
			haptics.warning();
			const first = check.missing.find((id) => id !== "until");
			if (first) ctx.focusField(first);
			announce(t.t("journal.contract.signHint"));
			return;
		}
		if (editor.sign()) {
			haptics.success();
			showToast(t.t("journal.contract.signedToast"), { tone: "success" });
		}
	};

	const share = () => {
		// Read at press time, so Share sends what was just saved.
		const stored = entryId ? store.getState().data.journal[entryId] : undefined;
		if (!stored) return;
		void shareContract(
			t.t("journal.contract.textTitle"),
			contractText(stored, habit, displayName, t),
			t,
		);
	};

	const setOutcome = (outcome: "kept" | "broken") => {
		if (!entryId) return;
		actions.setContractOutcome(entryId, contract.outcome === outcome ? null : outcome);
	};

	return (
		<View style={styles.contract}>
			{locked ? (
				contract.partner ? (
					<View style={styles.blockGap}>
						<Text variant="small" weight="medium" tone="muted">
							{t.t("journal.contract.partner")}
						</Text>
						<LockedAnswer question={t.t("journal.contract.partner")} value={contract.partner} />
					</View>
				) : null
			) : (
				<TextField
					label={`${t.t("journal.contract.partner")} · ${t.t("common.optional")}`}
					value={contract.partner ?? ""}
					onChangeText={(value) => setTerms({ partner: value || null })}
					maxLength={80}
					autoComplete="off"
					autoCapitalize="words"
					placeholder={t.t("journal.contract.partnerPlaceholder")}
					accessibilityLabel={t.t("journal.contract.partner")}
					accessibilityHint={t.t("common.optional")}
					returnKeyType="done"
					testID="journal-contract-partner"
				/>
			)}

			<View style={styles.blockGap}>
				<Text variant="small" weight="medium" tone="muted">
					{untilLabel}
				</Text>
				<PressableScale
					disabled={locked}
					scaleTo={0.97}
					onPress={() => setPicking(true)}
					accessibilityRole="button"
					accessibilityLabel={`${untilLabel}: ${t.formatDayLong(contract.until)}`}
					accessibilityState={{ disabled: locked }}
					style={[styles.untilField, locked && styles.untilLocked]}
					testID="journal-contract-until"
				>
					<CalendarDays size={18} color={colors.textMuted} strokeWidth={2} />
					<Text weight="semibold" style={styles.grow}>
						{capitalize(t.formatDayLong(contract.until))}
					</Text>
				</PressableScale>
				{locked ? null : (
					<ToggleGroup<number>
						type="single"
						size="sm"
						accessibilityLabel={t.t("journal.contract.length")}
						value={
							CONTRACT_LENGTHS.find((days) => addDays(start, days - 1) === contract.until) ?? null
						}
						onChange={(days) => setTerms({ until: addDays(start, days - 1) })}
						options={CONTRACT_LENGTHS.map((days) => ({
							value: days,
							label: t.tp("common.days", days),
						}))}
						style={styles.lengths}
						testID="journal-contract-length"
					/>
				)}
			</View>

			<View style={styles.signature} testID="journal-signature">
				{signed ? (
					<View style={styles.signatureBody}>
						<View>
							<View style={styles.signatureTop}>
								<Text variant="label" style={styles.grow}>
									{t.t("journal.contract.signature")}
								</Text>
								<ContractStatusBadge status={status} until={contract.until} />
							</View>
							{/* The name as a signature over a line; without a name, the signing date takes its place. */}
							<Text italic variant="display" style={styles.signatureName}>
								{name || signedLine}
							</Text>
							{name ? (
								<Text variant="small" tone="muted" style={styles.signedLine}>
									{signedLine}
								</Text>
							) : null}
						</View>
						<View style={styles.doneLine}>
							<Lock size={14} color={colors.textMuted} strokeWidth={2} />
							<Text variant="small" tone="muted" style={styles.grow}>
								{t.t("journal.contract.locked")}
							</Text>
						</View>
						<View style={styles.actionsRow}>
							<Button
								label={t.t("journal.contract.share")}
								icon={Share2}
								variant="secondary"
								size="sm"
								onPress={share}
								testID="journal-contract-share"
							/>
							<Button
								label={t.t("journal.contract.revoke")}
								variant="ghost"
								size="sm"
								onPress={() => {
									if (!entryId) return;
									haptics.light();
									actions.revokeContractSignature(entryId);
								}}
							/>
						</View>
						{status === "ended" || status === "kept" || status === "broken" ? (
							<View style={styles.outcome}>
								<Text weight="semibold">{t.t("journal.contract.outcome")}</Text>
								<ChoiceGroup<"kept" | "broken">
									label={t.t("journal.contract.outcome")}
									value={contract.outcome}
									allowEmpty
									onChange={(outcome) => setOutcome(outcome ?? contract.outcome ?? "kept")}
									options={[
										{ value: "kept", label: t.t("journal.contract.keptAction") },
										{ value: "broken", label: t.t("journal.contract.brokenAction") },
									]}
								/>
							</View>
						) : null}
					</View>
				) : (
					<View style={styles.signatureBody}>
						{/* Until it's complete, Sign stays pressable (it points to what's missing) but reads as secondary. */}
						<Button
							label={t.t("journal.contract.sign")}
							icon={Signature}
							variant={check.complete ? "primary" : "secondary"}
							size="md"
							onPress={sign}
							accessibilityHint={check.complete ? undefined : t.t("journal.contract.signHint")}
							style={styles.alignStart}
							testID="journal-contract-sign"
						/>
						{check.complete ? null : (
							<Text variant="small" tone="muted">
								{t.t("journal.contract.signHint")}
							</Text>
						)}
					</View>
				)}
			</View>

			<JournalDaySheet
				open={picking}
				title={untilLabel}
				value={contract.until}
				min={start}
				onClose={() => setPicking(false)}
				onPick={(until) => {
					setTerms({ until });
					setPicking(false);
				}}
			/>
		</View>
	);
}

// ── Review snapshot ──

const SCOPES: readonly ReviewScope[] = ["week", "month", "year"];

function IdentityBar({ color, ratio }: { color: HabitColor; ratio: number }) {
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(color);
	return (
		<View style={[styles.bar, { backgroundColor: tone.softer }]}>
			<View
				style={[
					styles.barFill,
					{ backgroundColor: tone.fill, width: `${Math.max(4, Math.round(ratio * 100))}%` },
				]}
			/>
		</View>
	);
}

function SnapshotBlock({ ctx }: { ctx: JournalBlockContext }) {
	const t = useT();
	const text = useText();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn) as Weekday;
	const habits = useAtomic((s) => s.data.habits);
	const identities = useIdentities();
	const { editor } = ctx;
	const range: JournalRange = editor.draft.range ?? reviewRange("week", today, weekStartsOn);
	const scope = reviewScopeOf(range, weekStartsOn) ?? "week";
	const snapshot = useReviewSnapshot(range);
	const label = rangeLabel(range, t, weekStartsOn);
	const nextRange = shiftReviewRange(range, scope, 1, weekStartsOn);
	const hasBreak = Object.values(habits).some((h) => !h.deletedAt && h.kind === "break");

	const setRange = (next: JournalRange) => {
		haptics.selection();
		editor.update({ range: next });
	};
	const byIdentity = (snapshot?.byIdentity ?? []).flatMap((row) => {
		const identity = identities.find((i) => i.id === row.identityId);
		return identity ? [{ ...row, identity }] : [];
	});
	const maxVotes = Math.max(1, ...byIdentity.map((row) => row.votes));
	const missed = (snapshot?.missedTwice ?? [])
		.map((id) => habits[id])
		.filter((h): h is Habit => !!h)
		.map((h) => text.habit(h, "name"));

	return (
		<View style={styles.snapshot} testID="journal-snapshot">
			<View style={styles.periodCard}>
				<SegmentedControl<ReviewScope>
					accessibilityLabel={t.t("journal.review.period")}
					size="sm"
					value={scope}
					onChange={(next) => editor.update({ range: reviewRange(next, today, weekStartsOn) })}
					segments={SCOPES.map((s) => ({
						value: s,
						label: t.t(`journal.review.unit.${s}` as MessageKey),
					}))}
				/>
				<View style={styles.periodRow}>
					<IconButton
						icon={ChevronLeft}
						variant="soft"
						size={36}
						iconSize={18}
						accessibilityLabel={t.t("journal.review.previous")}
						onPress={() => setRange(shiftReviewRange(range, scope, -1, weekStartsOn))}
						testID="journal-period-prev"
					/>
					<Text
						weight="semibold"
						align="center"
						tabular
						style={styles.grow}
						accessibilityLiveRegion="polite"
					>
						{label}
					</Text>
					<IconButton
						icon={ChevronRight}
						variant="soft"
						size={36}
						iconSize={18}
						disabled={nextRange.from > today}
						accessibilityLabel={t.t("journal.review.next")}
						onPress={() => setRange(nextRange)}
						testID="journal-period-next"
					/>
				</View>
			</View>

			<Text variant="label" accessibilityRole="header" style={styles.snapshotTitle}>
				{t.t("journal.snapshot.title")}
			</Text>
			{!snapshot || snapshot.daysTracked === 0 ? (
				<View style={styles.emptyNumbers}>
					<Text variant="small" tone="muted" align="center">
						{t.t("journal.snapshot.empty")}
					</Text>
				</View>
			) : (
				<>
					<View style={styles.tiles}>
						<StatTile label={t.t("journal.snapshot.votes")} value={t.number(snapshot.votes)} />
						<StatTile
							label={t.t("journal.snapshot.consistency")}
							value={t.percent(snapshot.consistency)}
						/>
						<StatTile
							label={t.t("journal.snapshot.perfectDays")}
							value={t.number(snapshot.perfectDays)}
						/>
						{hasBreak ? (
							<StatTile label={t.t("journal.snapshot.slips")} value={t.number(snapshot.slips)} />
						) : null}
						<StatTile
							label={t.t("journal.snapshot.evidence")}
							value={t.number(snapshot.evidence)}
						/>
					</View>

					{byIdentity.length ? (
						<View style={styles.blockGap}>
							<Text variant="small" weight="semibold" accessibilityRole="header">
								{t.t("journal.snapshot.byIdentity")}
							</Text>
							{byIdentity.map(({ identity, votes }) => {
								const statement = text.identity(identity, "statement");
								const count = t.tp("common.votes", votes);
								return (
									<View
										key={identity.id}
										style={styles.identityRow}
										accessible
										accessibilityLabel={`${statement}: ${count}`}
									>
										<View style={styles.identityLine}>
											<Text allowFontScaling={false}>{identity.emoji}</Text>
											<Text variant="small" numberOfLines={1} style={styles.grow}>
												{statement}
											</Text>
											<Text variant="small" tone="muted" tabular>
												{count}
											</Text>
										</View>
										<IdentityBar color={identity.color} ratio={votes / maxVotes} />
									</View>
								);
							})}
						</View>
					) : null}

					{snapshot.top.length ? (
						<View style={styles.blockGap}>
							<Text variant="small" weight="semibold" accessibilityRole="header">
								{t.t("journal.snapshot.top")}
							</Text>
							<View style={styles.topList}>
								{snapshot.top.map((row, index) => {
									const h = habits[row.habitId];
									if (!h) return null;
									const name = text.habit(h, "name");
									const ofDue = t.t("journal.snapshot.ofDue", {
										done: t.number(row.done),
										due: t.number(row.due),
									});
									return (
										<View
											key={row.habitId}
											style={[styles.topRow, index > 0 && styles.topDivider]}
											accessible
											accessibilityLabel={`${name}: ${ofDue}`}
										>
											<Text allowFontScaling={false}>{h.emoji}</Text>
											<Text variant="small" numberOfLines={1} style={styles.grow}>
												{name}
											</Text>
											<Text variant="small" tone="muted" tabular>
												{ofDue}
											</Text>
										</View>
									);
								})}
							</View>
						</View>
					) : null}

					<View style={styles.doneLine}>
						<Info size={14} color={colors.textMuted} strokeWidth={2} />
						<Text variant="small" tone="muted" style={styles.grow}>
							{missed.length
								? t.t("journal.snapshot.missedTwice", { habits: t.formatList(missed) })
								: t.t("journal.snapshot.neverMissedTwice")}
						</Text>
					</View>
				</>
			)}
		</View>
	);
}

// ── Side actions: Make it a task, the Scorecard ──

function MakeTaskBlock({ ctx, from }: { ctx: JournalBlockContext; from: string }) {
	const t = useT();
	const actions = useActions();
	const today = useToday();
	const styles = useStyles();
	const { editor } = ctx;
	const input = journalTaskInput(editor.draft, from, today);
	const [created, setCreated] = useState<{ id: string; title: string } | null>(null);
	if (created && input && created.title === input.title) {
		return (
			<View style={styles.doneLine} accessibilityLiveRegion="polite">
				<Text variant="small" weight="semibold" tone="success">
					{t.t("journal.taskCreated")}
				</Text>
				<Pressable
					onPress={() => router.push("/tasks")}
					hitSlop={10}
					accessibilityRole="link"
					style={styles.link}
				>
					<Text variant="small" weight="semibold" tone="accent">
						{t.t("nav.tasks")}
					</Text>
				</Pressable>
			</View>
		);
	}
	const make = () => {
		if (!input) return;
		const task = actions.createTask(input);
		haptics.success();
		setCreated({ id: task.id, title: input.title });
		undoToast(t, t.t("journal.taskCreated"), () => {
			actions.deleteTask(task.id);
			setCreated(null);
		});
	};
	return (
		<Button
			label={t.t("journal.makeTask")}
			icon={ListPlus}
			variant="secondary"
			size="sm"
			disabled={!input}
			onPress={make}
			style={styles.alignStart}
			testID={`journal-make-task-${from}`}
		/>
	);
}

function ScorecardBlock({ ctx }: { ctx: JournalBlockContext }) {
	const t = useT();
	const actions = useActions();
	const items = useScorecard();
	const styles = useStyles();
	const { editor } = ctx;
	const behavior = editor.draft.answers.behavior?.trim() ?? "";
	const rating = editor.draft.rating;
	const already = !!behavior && onScorecard(items, behavior);

	const add = () => {
		if (!behavior) return;
		const item = actions.createScorecardItem({
			label: behavior.slice(0, 160),
			rating: rating ?? "neutral",
			time: null,
		});
		haptics.success();
		undoToast(t, t.t("journal.awareness.added"), () => actions.deleteScorecardItem(item.id));
	};

	return (
		<View style={styles.actionsRow}>
			{already ? (
				<View style={[styles.doneLine, styles.minRow]} accessibilityLiveRegion="polite">
					<Text variant="small" weight="semibold" tone="success">
						{t.t("journal.awareness.onScorecard")}
					</Text>
				</View>
			) : (
				<Button
					label={t.t("journal.awareness.addToScorecard")}
					icon={ListPlus}
					variant="secondary"
					size="sm"
					disabled={!behavior}
					onPress={add}
					testID="journal-add-scorecard"
				/>
			)}
			{rating === "negative" && behavior ? (
				<Button
					label={t.t("journal.awareness.breakHabit")}
					iconRight={ChevronRight}
					variant="ghost"
					size="sm"
					onPress={() =>
						router.push({
							pathname: "/habit/editor",
							params: { kind: "break", name: behavior.slice(0, 120) },
						})
					}
					testID="journal-break-habit"
				/>
			) : null}
		</View>
	);
}

// ── The blocks of a kind, in order ──

function blockKey(block: JournalBlock, index: number): string {
	if (block.type === "prompt") return `prompt:${block.prompt.id}`;
	if (block.type === "makeTask") return `makeTask:${block.from}`;
	return `${block.type}:${index}`;
}

/**
 * The editor's body (Annex J §5): every block of the kind in order —
 * prompts with their question, example and helper line; the rating,
 * difficulty and cue choices; and the side actions, each with an Undo toast.
 * Required prompts are marked with "Required" text; "Answer at least one of
 * these." sits above a kind's any-of group while none is answered.
 */
export function JournalBlocks({ ctx }: { ctx: JournalBlockContext }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const { kind, habit, editor } = ctx;
	const blocks = journalBlocks(kind, habit);
	const anyOf = journalAnyOf(kind, habit);
	const missingAnyOf = editor.check.missing.includes("anyOf");
	const firstAnyOf = blocks.find((b) => b.type === "prompt" && anyOf.includes(b.prompt.id));

	return (
		<View style={styles.blocks}>
			{blocks.map((block, index) => {
				let content: ReactNode = null;
				switch (block.type) {
					case "prompt":
						content = <PromptBlock ctx={ctx} prompt={block.prompt} />;
						break;
					case "rating":
						content = <RatingBlock ctx={ctx} />;
						break;
					case "difficulty":
						content = <DifficultyBlock ctx={ctx} />;
						break;
					case "cueType":
						content = <CueTypeBlock ctx={ctx} />;
						break;
					case "intention":
					case "applyToHabit":
						// Only with a habit to plan for.
						if (habit) content = <PlanBlock ctx={ctx} />;
						break;
					case "goldilocks":
						// Appears once a difficulty is chosen; until then it leaves no gap.
						if (habit && editor.draft.difficulty) content = <GoldilocksBlock ctx={ctx} />;
						break;
					case "contract":
						content = <ContractBlock ctx={ctx} />;
						break;
					case "snapshot":
						content = <SnapshotBlock ctx={ctx} />;
						break;
					case "makeTask":
						content = <MakeTaskBlock ctx={ctx} from={block.from} />;
						break;
					case "scorecard":
						content = <ScorecardBlock ctx={ctx} />;
						break;
				}
				if (!content) return null;
				return (
					<View key={blockKey(block, index)} style={styles.block}>
						{missingAnyOf && block === firstAnyOf ? (
							<View style={styles.doneLine}>
								<Info size={16} color={colors.textMuted} strokeWidth={2} />
								<Text variant="small" tone="muted" style={styles.grow}>
									{t.t("journal.anyOf")}
								</Text>
							</View>
						) : null}
						{content}
					</View>
				);
			})}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	grow: { flex: 1, flexShrink: 1 },
	alignStart: { alignSelf: "flex-start" },
	blocks: { gap: 28 },
	block: { gap: 10 },
	blockGap: { gap: 12 },
	prompt: { gap: 8 },
	questionRow: {
		flexDirection: "row",
		alignItems: "flex-start",
		justifyContent: "space-between",
		gap: 12,
	},
	question: { flex: 1, flexShrink: 1 },
	hint: { marginTop: -2 },
	counter: { marginTop: -2 },
	timeField: { maxWidth: 220 },
	requiredTag: {
		height: 24,
		paddingHorizontal: 10,
		borderRadius: 999,
		justifyContent: "center",
		backgroundColor: t.colors.sunken,
	},
	locked: {
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
		borderRadius: t.radii.md,
		paddingHorizontal: 14,
		paddingVertical: 12,
	},
	lockedText: { fontSize: 15, lineHeight: 22 },
	choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	choice: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		minHeight: 42,
		maxWidth: "100%",
		paddingVertical: 8,
		paddingHorizontal: 16,
		borderRadius: 999,
		borderWidth: 1,
	},
	choiceLeading: { paddingLeft: 9 },
	choiceText: { flexShrink: 1 },
	disc: {
		width: 24,
		height: 24,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
	},
	discGlyph: { fontSize: 15, lineHeight: 18 },
	softCard: {
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		padding: 16,
		gap: 6,
	},
	planLines: { gap: 8, marginTop: 4 },
	planLine: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
	planIcon: { marginTop: 3 },
	planSentence: { fontSize: 22, lineHeight: 29, marginTop: 2 },
	planEmpty: { marginTop: 2 },
	tip: { marginTop: 4 },
	cardAction: { marginTop: 10 },
	doneLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
	minRow: { minHeight: 36 },
	link: { minHeight: 32, justifyContent: "center", paddingHorizontal: 2 },
	actionsRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
	// Contract
	contract: { gap: 20 },
	untilField: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		minHeight: 48,
		paddingHorizontal: 14,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	untilLocked: {
		backgroundColor: "transparent",
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
	},
	lengths: { marginTop: 2 },
	signature: {
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		padding: 16,
		...t.cardShadow,
	},
	signatureBody: { gap: 12 },
	signatureTop: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		flexWrap: "wrap",
	},
	signatureName: {
		marginTop: 8,
		paddingBottom: 4,
		borderBottomWidth: 1,
		borderBottomColor: t.colors.borderStrong,
	},
	signedLine: { marginTop: 6 },
	outcome: {
		gap: 10,
		paddingTop: 14,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
	},
	badge: {
		flexDirection: "row",
		alignItems: "center",
		gap: 5,
		minHeight: 26,
		paddingHorizontal: 10,
		borderRadius: 999,
		alignSelf: "flex-start",
	},
	badgeSm: { minHeight: 24, paddingHorizontal: 9, gap: 4 },
	// Day sheet
	calHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
	calWeek: { flexDirection: "row", marginBottom: 4 },
	calCell: { flex: 1, alignItems: "center" },
	calDay: {
		width: 40,
		height: 40,
		borderRadius: 20,
		alignItems: "center",
		justifyContent: "center",
	},
	// Review snapshot
	snapshot: { gap: 14 },
	periodCard: {
		gap: 10,
		padding: 10,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		...t.cardShadow,
	},
	periodRow: { flexDirection: "row", alignItems: "center", gap: 8 },
	snapshotTitle: { marginTop: 6 },
	emptyNumbers: {
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
		paddingVertical: 22,
		paddingHorizontal: 16,
	},
	tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
	identityRow: { gap: 6 },
	identityLine: { flexDirection: "row", alignItems: "center", gap: 8 },
	bar: { height: 6, borderRadius: 3, overflow: "hidden" },
	barFill: { height: 6, borderRadius: 3 },
	topList: {
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	topRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		minHeight: 46,
		paddingHorizontal: 14,
	},
	topDivider: { borderTopWidth: 1, borderTopColor: t.colors.border },
}));
