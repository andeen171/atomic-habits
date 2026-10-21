import { announce } from "@/lib/announce";
import { keepFocus } from "@/lib/focus";
import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
	CHECKIN_DIFFICULTIES,
	CONTRACT_LENGTHS,
	CUE_TYPES,
	type CheckinDifficulty,
	type DayKey,
	type Habit,
	type JournalBlock,
	type JournalKind,
	type JournalPrompt,
	type MessageKey,
	type ReviewScope,
	SCORECARD_RATINGS,
	type ScorecardRating,
	addDays,
	addMonths,
	applyRecoveryPlan,
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
	parseDayKey,
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
import { Link, useNavigate } from "@tanstack/react-router";
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
	Mountain,
	Share2,
	Signature,
	Target,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import {
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { Field, Input, Textarea } from "../ui/field";
import { IconButton } from "../ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { SegmentedControl } from "../ui/segmented";
import { StatTile } from "../ui/stat-tile";
import { TimeField } from "../ui/time-field";
import { ToggleGroup } from "../ui/toggle-group";

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
}

/** The DOM id of a prompt's control (the Sign button focuses the first missing one). */
export const promptFieldId = (id: string) => `journal-field-${id}`;

const filled = (value: string | null | undefined): value is string => !!value?.trim();

/** Signed terms read as text on the page rather than as fields to fill. */
const lockedClass =
	"read-only:cursor-default read-only:border-dashed read-only:bg-transparent read-only:hover:border-line read-only:focus-visible:ring-0";

/** "10 pages" / "10": a target with the habit's unit. */
function amount(habit: Habit, value: number, t: ReturnType<typeof useT>["t"]): string {
	return habit.unit ? `${t.number(value)} ${habit.unit}` : t.number(value);
}

// ── Shared pieces ──

function RequiredTag({ id }: { id: string }) {
	const { t } = useT();
	return (
		<span
			id={id}
			className="inline-flex h-6 shrink-0 items-center rounded-full bg-sunken px-2.5 font-medium text-ink-muted text-tiny"
		>
			{t("journal.required")}
		</span>
	);
}

/** A block's question line (the visible label of a prompt or a choice). */
function Question({
	id,
	htmlFor,
	children,
	requiredId,
}: {
	id?: string;
	htmlFor?: string;
	children: ReactNode;
	/** Shows "Required" while unanswered. */
	requiredId?: string;
}) {
	const className = "min-w-0 text-pretty font-semibold text-h3 text-ink";
	return (
		<div className="flex items-start justify-between gap-3">
			{htmlFor ? (
				<label id={id} htmlFor={htmlFor} className={className}>
					{children}
				</label>
			) : (
				<p id={id} className={className}>
					{children}
				</p>
			)}
			{requiredId ? <RequiredTag id={requiredId} /> : null}
		</div>
	);
}

/** Announces "N characters left" when an answer crosses 80%, 90% and 100% of its limit. */
function useLimitAnnouncements(length: number, max: number) {
	const { t } = useT();
	const bucket = length >= max ? 3 : length >= max * 0.9 ? 2 : length > max * 0.8 ? 1 : 0;
	const previous = useRef(bucket);
	useEffect(() => {
		if (bucket > previous.current) announce(t.tp("journal.charsLeft", Math.max(0, max - length)));
		previous.current = bucket;
	}, [bucket, length, max, t]);
}

/** Toast with an Undo action. */
function undoToast(
	t: ReturnType<typeof useT>["t"],
	message: string,
	undo: () => void,
	description?: string,
) {
	toast(message, { description, action: { label: t("common.undo"), onClick: undo } });
}

// ── Prompts ──

function PromptBlock({ ctx, prompt }: { ctx: JournalBlockContext; prompt: JournalPrompt }) {
	const { t } = useT();
	const { editor, kind, shown, locked } = ctx;
	const value = editor.draft.answers[prompt.id] ?? "";
	const id = promptFieldId(prompt.id);
	const hintId = `${id}-hint`;
	const requiredId = `${id}-required`;
	const countId = `${id}-count`;
	const missing = prompt.required && !value.trim();
	const showCount = prompt.input !== "time" && value.length > prompt.maxLength * 0.8;
	useLimitAnnouncements(prompt.input === "time" ? 0 : value.length, prompt.maxLength);

	const hint = prompt.hasHint ? t(journalHintKey(kind, prompt.id)) : null;
	const placeholder = prompt.hasExample ? t(journalExampleKey(kind, prompt.id)) : undefined;
	const describedBy =
		[hint && hintId, missing && requiredId, showCount && countId].filter(Boolean).join(" ") ||
		undefined;
	const set = (next: string) => editor.setAnswer(prompt.id, next);

	let control: ReactNode;
	if (prompt.input === "time") {
		control = (
			<TimeField
				id={id}
				data-journal-field=""
				aria-describedby={describedBy}
				disabled={locked}
				value={value || null}
				onChange={(next) => set(next ?? "")}
				className="max-w-44"
			/>
		);
	} else if (prompt.input === "line") {
		control = (
			<Input
				id={id}
				data-journal-field=""
				aria-describedby={describedBy}
				aria-required={prompt.required || undefined}
				readOnly={locked}
				maxLength={prompt.maxLength}
				placeholder={placeholder}
				value={value}
				onChange={(event) => set(event.target.value)}
				enterKeyHint="next"
				className={lockedClass}
			/>
		);
	} else {
		control = (
			<Textarea
				id={id}
				data-journal-field=""
				autoGrow
				minRows={prompt.maxLength >= 2000 ? 3 : 2}
				aria-describedby={describedBy}
				aria-required={prompt.required || undefined}
				readOnly={locked}
				maxLength={prompt.maxLength}
				placeholder={placeholder}
				value={value}
				onChange={(event) => set(event.target.value)}
				className={lockedClass}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<Question htmlFor={id} requiredId={missing ? requiredId : undefined}>
				{t(journalPromptKey(kind, prompt.id), { habit: shown?.name ?? "" })}
			</Question>
			{hint ? (
				<p id={hintId} className="-mt-1 text-pretty text-ink-muted text-small">
					{hint}
				</p>
			) : null}
			{control}
			{showCount ? (
				<p id={countId} className="self-end text-ink-subtle text-tiny tabular-nums">
					{t("journal.counter", {
						count: t.number(value.length),
						max: t.number(prompt.maxLength),
					})}
				</p>
			) : null}
		</div>
	);
}

// ── Single choices (rating, difficulty) ──

interface ChoiceOption<T extends string> {
	value: T;
	label: string;
	icon: ReactNode;
}

/**
 * A radio group of pills (radio pattern: one tab stop, arrows move and
 * select). Nothing is selected at first; then the first option takes focus.
 */
function ChoiceGroup<T extends string>({
	labelledBy,
	describedBy,
	value,
	options,
	onChange,
	disabled,
}: {
	labelledBy: string;
	describedBy?: string;
	value: T | null;
	options: readonly ChoiceOption<T>[];
	onChange(value: T): void;
	disabled?: boolean;
}) {
	const refs = useRef<(HTMLButtonElement | null)[]>([]);
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		const delta =
			event.key === "ArrowRight" || event.key === "ArrowDown"
				? 1
				: event.key === "ArrowLeft" || event.key === "ArrowUp"
					? -1
					: 0;
		if (!delta || disabled) return;
		event.preventDefault();
		const next = (index + delta + options.length) % options.length;
		const option = options[next];
		if (!option) return;
		onChange(option.value);
		refs.current[next]?.focus();
	};
	const focusable = value === null ? 0 : options.findIndex((o) => o.value === value);
	return (
		<div
			role="radiogroup"
			aria-labelledby={labelledBy}
			aria-describedby={describedBy}
			aria-disabled={disabled || undefined}
			className="flex flex-wrap gap-2"
		>
			{options.map((option, index) => {
				const selected = option.value === value;
				return (
					<button
						key={option.value}
						ref={(el) => {
							refs.current[index] = el;
						}}
						type="button"
						// biome-ignore lint/a11y/useSemanticElements: styled radio with full ARIA state and roving focus.
						role="radio"
						aria-checked={selected}
						tabIndex={index === focusable ? 0 : -1}
						disabled={disabled}
						onKeyDown={(event) => onKeyDown(event, index)}
						onClick={() => onChange(option.value)}
						className={cn(
							"inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border py-1.5 pr-4 pl-2 text-left font-medium text-small leading-snug transition-colors duration-(--atomic-duration-fast) disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0",
							selected
								? "border-ink bg-ink text-bg"
								: "border-line bg-surface text-ink hover:border-line-strong hover:bg-hover",
						)}
					>
						{option.icon}
						<span className="min-w-0 break-words">{option.label}</span>
					</button>
				);
			})}
		</div>
	);
}

export const RATING_SYMBOL: Record<ScorecardRating, string> = {
	positive: "+",
	neutral: "=",
	negative: "−",
};
/** Solid tone discs (as on the Scorecard): the glyph reads in both themes, and the label carries the meaning. */
export const RATING_DISC: Record<ScorecardRating, string> = {
	positive: "bg-success text-surface",
	neutral: "bg-sunken text-ink-muted ring-1 ring-line-strong",
	negative: "bg-danger text-surface",
};

function RatingBlock({ ctx }: { ctx: JournalBlockContext }) {
	const { t } = useT();
	const { editor, kind } = ctx;
	const labelId = useId();
	const requiredId = useId();
	const missing = editor.draft.rating == null;
	return (
		<div className="flex flex-col gap-3">
			<Question id={labelId} requiredId={missing ? requiredId : undefined}>
				{t(journalPromptKey(kind, "rating"))}
			</Question>
			<ChoiceGroup<ScorecardRating>
				labelledBy={labelId}
				describedBy={missing ? requiredId : undefined}
				value={editor.draft.rating}
				onChange={(rating) => editor.update({ rating })}
				options={SCORECARD_RATINGS.map((rating) => ({
					value: rating,
					label: t(`journal.rating.${rating}`),
					icon: (
						<span
							aria-hidden="true"
							className={cn(
								"grid size-6 shrink-0 place-items-center rounded-full font-semibold text-[0.95rem] leading-none",
								RATING_DISC[rating],
							)}
						>
							{RATING_SYMBOL[rating]}
						</span>
					),
				}))}
			/>
		</div>
	);
}

export const DIFFICULTY_ICON: Record<CheckinDifficulty, typeof Feather> = {
	"too-easy": Feather,
	"just-right": Target,
	"too-hard": Mountain,
};

function DifficultyBlock({ ctx }: { ctx: JournalBlockContext }) {
	const { t } = useT();
	const { editor, kind, shown } = ctx;
	const labelId = useId();
	const requiredId = useId();
	const missing = editor.draft.difficulty == null;
	return (
		<div className="flex flex-col gap-3">
			<Question id={labelId} requiredId={missing ? requiredId : undefined}>
				{t(journalPromptKey(kind, "difficulty"), { habit: shown?.name ?? "" })}
			</Question>
			<ChoiceGroup<CheckinDifficulty>
				labelledBy={labelId}
				describedBy={missing ? requiredId : undefined}
				value={editor.draft.difficulty}
				onChange={(difficulty) => editor.update({ difficulty })}
				options={CHECKIN_DIFFICULTIES.map((difficulty) => {
					const Icon = DIFFICULTY_ICON[difficulty];
					return {
						value: difficulty,
						label: t(`journal.difficulty.${difficulty}`),
						icon: (
							<span aria-hidden="true" className="grid size-6 place-items-center">
								<Icon />
							</span>
						),
					};
				})}
			/>
		</div>
	);
}

function CueTypeBlock({ ctx }: { ctx: JournalBlockContext }) {
	const { t } = useT();
	const { editor, kind } = ctx;
	const question = t(journalPromptKey(kind, "cueType"));
	const value = editor.draft.answers.cueType;
	return (
		<div className="flex flex-col gap-3">
			<p aria-hidden="true" className="text-pretty font-semibold text-h3 text-ink">
				{question}
			</p>
			<ToggleGroup
				type="single"
				allowEmpty
				label={question}
				value={(CUE_TYPES as readonly string[]).includes(value ?? "") ? (value ?? null) : null}
				onChange={(next) => editor.setAnswer("cueType", next ?? "")}
				options={CUE_TYPES.map((cue) => ({ value: cue, label: t(`cue.${cue}`) }))}
			/>
		</div>
	);
}

// ── The plan (recovery) ──

/** "Your plan": the live intention sentence (build) or the hide/friction lines (break), and "Make this the habit's plan". */
function PlanBlock({ ctx }: { ctx: JournalBlockContext }) {
	const { t } = useT();
	const text = useText();
	const store = useAtomicStore();
	const titleId = useId();
	const { editor, kind, habit, shown } = ctx;
	const style = useHabitStyle(habit?.color ?? "amber");
	if (!habit || !shown) return null;
	const answers = editor.draft.answers;
	const live = !habit.deletedAt && !habit.archivedAt;
	const isBreak = habit.kind === "break";
	const sentence = isBreak ? null : intentionSentence(shown, answers, t);
	const lines = isBreak
		? [
				{ key: "hide", icon: <EyeOff />, text: answers.hide },
				{ key: "friction", icon: <Lock />, text: answers.friction },
			].filter((line) => filled(line.text))
		: [];
	const patch = live ? habitPatchFromRecovery(habit, answers) : null;
	const anyAnswered = journalAnyOf(kind, habit).some((id) => filled(answers[id]));

	const apply = (event: MouseEvent<HTMLButtonElement>) => {
		const undo = applyRecoveryPlan(store, habit.id, answers);
		keepFocus(event.currentTarget);
		if (!undo) return;
		undoToast(t, t("journal.habitUpdated"), undo, text.habit(habit, "name"));
	};

	return (
		<section
			aria-labelledby={titleId}
			style={style}
			className="rounded-xl border border-line bg-(--habit-softer) p-4 md:p-5"
		>
			<h3 id={titleId} className="section-label">
				{t("journal.recovery.yourPlan")}
			</h3>
			{isBreak ? (
				lines.length ? (
					<ul className="mt-2.5 flex flex-col gap-2">
						{lines.map((line) => (
							<li key={line.key} className="flex items-start gap-2.5 text-ink">
								<span
									aria-hidden="true"
									className="mt-0.5 text-(--habit-text) [&_svg]:size-4 [&_svg]:shrink-0"
								>
									{line.icon}
								</span>
								<span className="min-w-0 break-words">{line.text}</span>
							</li>
						))}
					</ul>
				) : (
					<p className="mt-2 text-ink-muted text-small">{t("journal.anyOf")}</p>
				)
			) : sentence ? (
				<p className="mt-2 text-pretty break-words font-display text-[1.375rem] text-ink leading-[1.875rem]">
					{sentence}
				</p>
			) : (
				<p className="mt-2 text-pretty text-ink-muted text-small">{t("journal.plan.empty")}</p>
			)}
			{live && anyAnswered ? (
				<div className="mt-4">
					{patch ? (
						<Button variant="secondary" size="sm" onClick={apply}>
							{t("journal.applyToHabit")}
						</Button>
					) : (
						<p className="flex items-center gap-1.5 font-medium text-small text-success">
							{t("journal.plan.isHabitPlan")}
						</p>
					)}
				</div>
			) : null}
		</section>
	);
}

// ── Goldilocks (check-in) ──

function GoldilocksBlock({ ctx }: { ctx: JournalBlockContext }) {
	const { t } = useT();
	const text = useText();
	const { editor, habit, shown } = ctx;
	const live = habit && !habit.deletedAt ? habit : undefined;
	const difficulty = editor.draft.difficulty;
	const { suggestion, apply } = useGoldilocks(live, difficulty);
	const [applied, setApplied] = useState<{ difficulty: CheckinDifficulty; target: number } | null>(
		null,
	);
	const style = useHabitStyle(habit?.color ?? "sky");
	if (!difficulty || !habit || !shown) return null;
	const usable = !!live && !live.archivedAt;
	const done =
		applied && applied.difficulty === difficulty && live?.target === applied.target
			? applied.target
			: null;

	const onApply = (event: MouseEvent<HTMLButtonElement>) => {
		if (!suggestion || suggestion.type !== "target") return;
		const undo = apply();
		keepFocus(event.currentTarget);
		if (!undo) return;
		setApplied({ difficulty, target: suggestion.target });
		undoToast(
			t,
			t("journal.goldilocks.applied"),
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
		body = t("journal.goldilocks.right");
	} else if (difficulty === "too-easy") {
		body = (
			<>
				{t("journal.goldilocks.easy")}
				{suggestion ? null : (
					<span className="mt-1.5 block text-ink-muted">{t("journal.goldilocks.easyTip")}</span>
				)}
			</>
		);
	} else if (suggestion?.type === "twoMinute") {
		body = suggestion.twoMinute
			? t("journal.goldilocks.useTwoMinute", { twoMinute: suggestion.twoMinute })
			: t("journal.goldilocks.hard");
		if (!suggestion.twoMinute && usable) {
			action = (
				<Button asChild variant="secondary" size="sm">
					<Link to="/habits/$habitId/edit" params={{ habitId: habit.id }}>
						{t("journal.goldilocks.defineTwoMinute")}
					</Link>
				</Button>
			);
		}
	} else {
		body = t("journal.goldilocks.hard");
	}
	if (suggestion?.type === "target" && usable) {
		const raise = difficulty === "too-easy";
		action = done ? (
			<p className="flex items-center gap-1.5 font-medium text-small text-success">
				{t("journal.goldilocks.now", { target: amount(shown, done, t) })}
			</p>
		) : (
			<Button variant="secondary" size="sm" onClick={onApply}>
				{raise ? <TrendingUp /> : <TrendingDown />}
				{t(raise ? "journal.goldilocks.raise" : "journal.goldilocks.lower", {
					target: amount(shown, suggestion.target, t),
				})}
			</Button>
		);
	}

	return (
		<div
			style={style}
			className="animate-fade-in rounded-xl border border-line bg-(--habit-softer) p-4 md:p-5"
		>
			<p className="text-pretty text-ink">{body}</p>
			{action ? <div className="mt-4 flex flex-wrap gap-2">{action}</div> : null}
		</div>
	);
}

// ── Day picker (entry date, contract end) ──

/** A month calendar in a popover, limited to [min, max]. */
export function JournalDayPicker({
	value,
	onChange,
	min,
	max,
	children,
}: {
	value: DayKey;
	onChange(day: DayKey): void;
	min?: DayKey;
	max?: DayKey;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-72"
				onOpenAutoFocus={(event) => {
					const day = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
						'[aria-pressed="true"]',
					);
					if (day) {
						event.preventDefault();
						day.focus();
					}
				}}
			>
				<DayGrid
					value={value}
					min={min}
					max={max}
					onPick={(day) => {
						onChange(day);
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

function DayGrid({
	value,
	min,
	max,
	onPick,
}: { value: DayKey; min?: DayKey; max?: DayKey; onPick(day: DayKey): void }) {
	const { t, at } = useT();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const [month, setMonth] = useState(() => startOfMonth(value));
	const out = (day: DayKey) => (min !== undefined && day < min) || (max !== undefined && day > max);
	const canPrev = min === undefined || addDays(month, -1) >= min;
	const canNext = max === undefined || addMonths(month, 1) <= max;
	return (
		<div>
			<div className="mb-2 flex items-center justify-between">
				<span aria-live="polite" className="pl-1 font-medium text-ink text-small">
					{t.formatMonth(month)}
				</span>
				<div className="flex">
					<IconButton
						label={at("month.previous")}
						size="sm"
						disabled={!canPrev}
						onClick={() => setMonth(addMonths(month, -1))}
					>
						<ChevronLeft />
					</IconButton>
					<IconButton
						label={at("month.next")}
						size="sm"
						disabled={!canNext}
						onClick={() => setMonth(addMonths(month, 1))}
					>
						<ChevronRight />
					</IconButton>
				</div>
			</div>
			<div className="grid grid-cols-7 gap-0.5 text-center">
				{orderedWeekdays(weekStartsOn).map((wd) => (
					<span
						key={wd}
						aria-hidden="true"
						className="pb-1 font-semibold text-[10px] text-ink-subtle uppercase"
					>
						{t.weekdayName(wd, "min")}
					</span>
				))}
				{monthGrid(month, weekStartsOn)
					.flat()
					.map((day) => {
						const selected = day === value;
						const disabled = out(day);
						return (
							<button
								key={day}
								type="button"
								aria-label={t.formatDayLong(day)}
								aria-pressed={selected}
								aria-current={day === today ? "date" : undefined}
								disabled={disabled}
								onClick={() => onPick(day)}
								className={cn(
									"grid aspect-square place-items-center rounded-full text-small tabular-nums transition-colors disabled:cursor-default disabled:opacity-35",
									!isSameMonth(day, month) && "text-ink-subtle/60",
									day === today && !selected && "font-semibold text-accent-text",
									selected
										? "bg-accent font-semibold text-on-accent"
										: !disabled && "hover:bg-hover",
								)}
							>
								{parseDayKey(day).getDate()}
							</button>
						);
					})}
			</div>
		</div>
	);
}

// ── Habit contract ──

async function shareText(title: string, text: string): Promise<"shared" | "copied" | "failed"> {
	if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
		try {
			await navigator.share({ title, text });
			return "shared";
		} catch (error) {
			if ((error as { name?: string })?.name === "AbortError") return "shared";
		}
	}
	try {
		await navigator.clipboard.writeText(text);
		return "copied";
	} catch {
		return "failed";
	}
}

function ContractBlock({ ctx }: { ctx: JournalBlockContext }) {
	const { t } = useT();
	const actions = useActions();
	const store = useAtomicStore();
	const today = useToday();
	const displayName = useAtomic((s) => s.settings.displayName);
	const { editor, habit, locked, entryId } = ctx;
	const { draft, check } = editor;
	const start = draft.date;
	const contract = draft.contract ?? {
		until: addDays(start, 29),
		partner: null,
		signedAt: null,
		outcome: null,
	};
	const status = contractStatus(draft, today);
	const signed = contract.signedAt != null;
	const signHintId = useId();
	const lengthsId = useId();
	const outcomeId = useId();

	const signedLine = t("journal.contract.signed", {
		date: t.formatDayShort(toDayKey(contract.signedAt ?? Date.now())),
	});

	const setTerms = (patch: Partial<typeof contract>) =>
		editor.update({ contract: { ...contract, ...patch } });

	const sign = () => {
		if (!check.complete) {
			const first = check.missing.find((id) => id !== "until");
			const field = first ? document.getElementById(promptFieldId(first)) : null;
			field?.focus();
			announce(t("journal.contract.signHint"));
			return;
		}
		if (editor.sign()) toast.success(t("journal.contract.signedToast"));
	};

	const share = async () => {
		// Read at click time, so Share sends what was just saved.
		const stored = entryId ? store.getState().data.journal[entryId] : undefined;
		if (!stored) return;
		const result = await shareText(
			t("journal.contract.textTitle"),
			contractText(stored, habit, displayName, t),
		);
		if (result === "copied") toast(t("journal.contract.copied"));
	};

	const setOutcome = (outcome: "kept" | "broken") => {
		if (!entryId) return;
		actions.setContractOutcome(entryId, contract.outcome === outcome ? null : outcome);
	};

	return (
		<div className="flex flex-col gap-6">
			<Field label={t("journal.contract.partner")} optional={t("common.optional")}>
				{(props) => (
					<Input
						{...props}
						readOnly={locked}
						className={lockedClass}
						maxLength={80}
						autoComplete="off"
						placeholder={t("journal.contract.partnerPlaceholder")}
						value={contract.partner ?? ""}
						onChange={(event) => setTerms({ partner: event.target.value || null })}
					/>
				)}
			</Field>

			<div className="flex flex-col gap-2">
				<p id={lengthsId} className="font-medium text-ink text-small">
					{t("journal.contract.until")}
				</p>
				<div className="flex flex-wrap items-center gap-2">
					<JournalDayPicker
						value={contract.until}
						min={start}
						onChange={(until) => setTerms({ until })}
					>
						<Chip
							selected={false}
							disabled={locked}
							aria-label={`${t("journal.contract.until")}: ${t.formatDayLong(contract.until)}`}
							className="disabled:opacity-60"
						>
							<CalendarDays />
							<span className="text-ink">{t.formatDayLong(contract.until)}</span>
						</Chip>
					</JournalDayPicker>
					{locked ? null : (
						<ToggleGroup
							type="single"
							size="sm"
							label={t("journal.contract.length")}
							value={
								CONTRACT_LENGTHS.find((days) => addDays(start, days - 1) === contract.until) ?? null
							}
							onChange={(days) => {
								if (days) setTerms({ until: addDays(start, days - 1) });
							}}
							options={CONTRACT_LENGTHS.map((days) => ({
								value: days,
								label: t.tp("common.days", days),
							}))}
						/>
					)}
				</div>
			</div>

			<section
				aria-label={t("journal.contract.signature")}
				className="rounded-xl border border-line bg-surface p-4 shadow-card md:p-5"
			>
				{signed ? (
					<div className="flex flex-col gap-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="section-label">{t("journal.contract.signature")}</p>
								{/* The name as a signature over a line; without a name, the signing date takes its place. */}
								<p className="mt-1 break-words border-line-strong border-b pb-1 font-display text-[1.75rem] text-ink italic leading-9">
									{displayName.trim() || signedLine}
								</p>
								{displayName.trim() ? (
									<p className="mt-1.5 text-ink-muted text-small">{signedLine}</p>
								) : null}
							</div>
							<ContractStatusBadge status={status} until={contract.until} />
						</div>
						<p className="flex items-start gap-2 text-ink-muted text-small">
							<Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
							{t("journal.contract.locked")}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button variant="secondary" size="sm" onClick={() => void share()}>
								<Share2 />
								{t("journal.contract.share")}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={(event) => {
									if (!entryId) return;
									actions.revokeContractSignature(entryId);
									keepFocus(event.currentTarget);
								}}
							>
								{t("journal.contract.revoke")}
							</Button>
						</div>
						{status === "ended" || status === "kept" || status === "broken" ? (
							<div className="flex flex-col gap-2 border-line border-t pt-4">
								<p id={outcomeId} className="font-semibold text-ink">
									{t("journal.contract.outcome")}
								</p>
								<fieldset aria-labelledby={outcomeId} className="flex flex-wrap gap-2">
									{(["kept", "broken"] as const).map((outcome) => (
										<Chip
											key={outcome}
											selected={contract.outcome === outcome}
											onClick={() => setOutcome(outcome)}
											className="h-9 px-3.5"
										>
											{t(
												outcome === "kept"
													? "journal.contract.keptAction"
													: "journal.contract.brokenAction",
											)}
										</Chip>
									))}
								</fieldset>
							</div>
						) : null}
					</div>
				) : (
					<div className="flex flex-col items-start gap-3">
						<Button
							onClick={sign}
							aria-disabled={check.complete ? undefined : true}
							aria-describedby={check.complete ? undefined : signHintId}
							className={cn(!check.complete && "opacity-50")}
						>
							<Signature />
							{t("journal.contract.sign")}
						</Button>
						{check.complete ? null : (
							<p id={signHintId} className="text-ink-muted text-small">
								{t("journal.contract.signHint")}
							</p>
						)}
					</div>
				)}
			</section>
		</div>
	);
}

const STATUS_STYLE = {
	draft: "bg-sunken text-ink-muted",
	active: "bg-success-soft text-success",
	ended: "bg-warning-soft text-warning",
	kept: "bg-success-soft text-success",
	broken: "bg-danger-soft text-danger",
} as const;

export function ContractStatusBadge({
	status,
	until,
	size = "md",
}: {
	status: keyof typeof STATUS_STYLE;
	until: DayKey;
	/** "sm": the 24px badge of entry cards. */
	size?: "sm" | "md";
}) {
	const { t } = useT();
	const label =
		status === "active"
			? t("journal.contract.active", { date: t.formatDayShort(until) })
			: t(`journal.contract.${status}` as MessageKey);
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold text-tiny",
				size === "sm" ? "h-6 px-2.5" : "h-7 px-3",
				STATUS_STYLE[status],
			)}
		>
			{status === "kept" || status === "active" ? (
				<CircleCheck aria-hidden="true" className="size-3.5" />
			) : null}
			{label}
		</span>
	);
}

// ── Review snapshot ──

const SCOPES: readonly ReviewScope[] = ["week", "month", "year"];

function SnapshotBlock({ ctx }: { ctx: JournalBlockContext }) {
	const { t } = useT();
	const text = useText();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const habits = useAtomic((s) => s.data.habits);
	const identities = useIdentities();
	const { editor } = ctx;
	const range = editor.draft.range ?? reviewRange("week", today, weekStartsOn);
	const scope = reviewScopeOf(range, weekStartsOn) ?? "week";
	const snapshot = useReviewSnapshot(range);
	const titleId = useId();
	const label = rangeLabel(range, t, weekStartsOn);
	const nextRange = shiftReviewRange(range, scope, 1, weekStartsOn);
	const hasBreak = Object.values(habits).some((h) => !h.deletedAt && h.kind === "break");

	const setRange = (next: typeof range) => editor.update({ range: next });
	const byIdentity = (snapshot?.byIdentity ?? [])
		.map((row) => ({ ...row, identity: identities.find((i) => i.id === row.identityId) }))
		.filter((row) => row.identity);
	const maxVotes = Math.max(1, ...byIdentity.map((row) => row.votes));
	const missed = (snapshot?.missedTwice ?? [])
		.map((id) => habits[id])
		.filter((h): h is Habit => !!h)
		.map((h) => text.habit(h, "name"));

	return (
		<section aria-labelledby={titleId} className="flex flex-col gap-4">
			<div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
				<SegmentedControl<ReviewScope>
					label={t("journal.review.period")}
					size="sm"
					value={scope}
					onChange={(next) => setRange(reviewRange(next, today, weekStartsOn))}
					options={SCOPES.map((s) => ({
						value: s,
						label: t(`journal.review.unit.${s}` as MessageKey),
					}))}
				/>
				<div className="flex items-center justify-between gap-1 sm:justify-end">
					<IconButton
						label={t("journal.review.previous")}
						onClick={() => setRange(shiftReviewRange(range, scope, -1, weekStartsOn))}
					>
						<ChevronLeft />
					</IconButton>
					<p
						aria-live="polite"
						className="min-w-0 flex-1 text-center font-semibold text-ink tabular-nums sm:min-w-36 sm:flex-none"
					>
						{label}
					</p>
					<IconButton
						label={t("journal.review.next")}
						disabled={nextRange.from > today}
						onClick={() => setRange(nextRange)}
					>
						<ChevronRight />
					</IconButton>
				</div>
			</div>

			<h3 id={titleId} className="section-label mt-2">
				{t("journal.snapshot.title")}
			</h3>
			{!snapshot || snapshot.daysTracked === 0 ? (
				<p className="rounded-xl border border-line border-dashed px-4 py-6 text-center text-ink-muted text-small">
					{t("journal.snapshot.empty")}
				</p>
			) : (
				<>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
						<StatTile label={t("journal.snapshot.votes")} value={t.number(snapshot.votes)} />
						<StatTile
							label={t("journal.snapshot.consistency")}
							value={t.percent(snapshot.consistency)}
						/>
						<StatTile
							label={t("journal.snapshot.perfectDays")}
							value={t.number(snapshot.perfectDays)}
						/>
						{hasBreak ? (
							<StatTile label={t("journal.snapshot.slips")} value={t.number(snapshot.slips)} />
						) : null}
						<StatTile label={t("journal.snapshot.evidence")} value={t.number(snapshot.evidence)} />
					</div>

					{byIdentity.length ? (
						<div className="flex flex-col gap-2.5">
							<h4 className="font-semibold text-ink text-small">
								{t("journal.snapshot.byIdentity")}
							</h4>
							<ul className="flex flex-col gap-2">
								{byIdentity.map(({ identity, votes }) =>
									identity ? (
										<li
											key={identity.id}
											className="grid grid-cols-[1fr_auto] items-center gap-x-3"
										>
											<span className="flex min-w-0 items-center gap-2 text-ink text-small">
												<span aria-hidden="true" className="font-emoji">
													{identity.emoji}
												</span>
												<span className="truncate">{text.identity(identity, "statement")}</span>
											</span>
											<span className="text-ink-muted text-small tabular-nums">
												{t.tp("common.votes", votes)}
											</span>
											<IdentityBar color={identity.color} ratio={votes / maxVotes} />
										</li>
									) : null,
								)}
							</ul>
						</div>
					) : null}

					{snapshot.top.length ? (
						<div className="flex flex-col gap-2.5">
							<h4 className="font-semibold text-ink text-small">{t("journal.snapshot.top")}</h4>
							<ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
								{snapshot.top.map((row) => {
									const h = habits[row.habitId];
									if (!h) return null;
									return (
										<li key={row.habitId} className="flex items-center gap-3 px-4 py-2.5">
											<span aria-hidden="true" className="font-emoji">
												{h.emoji}
											</span>
											<span className="min-w-0 flex-1 truncate text-ink text-small">
												{text.habit(h, "name")}
											</span>
											<span className="text-ink-muted text-small tabular-nums">
												{t("journal.snapshot.ofDue", {
													done: t.number(row.done),
													due: t.number(row.due),
												})}
											</span>
										</li>
									);
								})}
							</ul>
						</div>
					) : null}

					<p className="flex items-start gap-2 text-ink-muted text-small">
						<Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
						{missed.length
							? t("journal.snapshot.missedTwice", { habits: t.formatList(missed) })
							: t("journal.snapshot.neverMissedTwice")}
					</p>
				</>
			)}
		</section>
	);
}

function IdentityBar({ color, ratio }: { color: Habit["color"]; ratio: number }) {
	const style = useHabitStyle(color);
	return (
		<span
			aria-hidden="true"
			style={style}
			className="col-span-2 mt-1 block h-1.5 overflow-hidden rounded-full bg-(--habit-softer)"
		>
			<span
				className="block h-full rounded-full bg-(--habit) transition-[width] duration-(--atomic-duration-slow) motion-reduce:transition-none"
				style={{ width: `${Math.max(4, Math.round(ratio * 100))}%` }}
			/>
		</span>
	);
}

// ── Side actions: Make it a task, the Scorecard ──

function MakeTaskBlock({ ctx, from }: { ctx: JournalBlockContext; from: string }) {
	const { t } = useT();
	const actions = useActions();
	const today = useToday();
	const { editor } = ctx;
	const input = journalTaskInput(editor.draft, from, today);
	const [created, setCreated] = useState<{ id: string; title: string } | null>(null);
	if (created && input && created.title === input.title) {
		return (
			<p className="flex items-center gap-1.5 font-medium text-small text-success">
				{t("journal.taskCreated")}
				<Link
					to="/tasks"
					className="ml-1 rounded-sm text-accent-text underline-offset-4 hover:underline"
				>
					{t("nav.tasks")}
				</Link>
			</p>
		);
	}
	const make = (event: MouseEvent<HTMLButtonElement>) => {
		if (!input) return;
		const task = actions.createTask(input);
		setCreated({ id: task.id, title: input.title });
		keepFocus(event.currentTarget);
		undoToast(t, t("journal.taskCreated"), () => {
			actions.deleteTask(task.id);
			setCreated(null);
		});
	};
	return (
		<div>
			<Button variant="secondary" size="sm" disabled={!input} onClick={make}>
				<ListPlus />
				{t("journal.makeTask")}
			</Button>
		</div>
	);
}

function ScorecardBlock({ ctx }: { ctx: JournalBlockContext }) {
	const { t } = useT();
	const actions = useActions();
	const navigate = useNavigate();
	const items = useScorecard();
	const { editor } = ctx;
	const behavior = editor.draft.answers.behavior?.trim() ?? "";
	const rating = editor.draft.rating;
	const already = !!behavior && onScorecard(items, behavior);

	const add = (event: MouseEvent<HTMLButtonElement>) => {
		if (!behavior) return;
		const item = actions.createScorecardItem({
			label: behavior.slice(0, 160),
			rating: rating ?? "neutral",
			time: null,
		});
		keepFocus(event.currentTarget);
		undoToast(t, t("journal.awareness.added"), () => actions.deleteScorecardItem(item.id));
	};

	return (
		<div className="flex flex-wrap items-center gap-2">
			{already ? (
				<p className="flex min-h-8 items-center font-medium text-small text-success">
					{t("journal.awareness.onScorecard")}
				</p>
			) : (
				<Button variant="secondary" size="sm" disabled={!behavior} onClick={add}>
					<ListPlus />
					{t("journal.awareness.addToScorecard")}
				</Button>
			)}
			{rating === "negative" && behavior ? (
				<Button
					variant="ghost"
					size="sm"
					onClick={() =>
						void navigate({
							to: "/habits/new",
							search: { kind: "break", name: behavior.slice(0, 120) },
						})
					}
				>
					{t("journal.awareness.breakHabit")}
					<ChevronRight />
				</Button>
			) : null}
		</div>
	);
}

// ── The blocks of a kind, in order ──

function blockKey(block: JournalBlock, index: number): string {
	if (block.type === "prompt") return `prompt:${block.prompt.id}`;
	if (block.type === "makeTask") return `makeTask:${block.from}`;
	return `${block.type}:${index}`;
}

/**
 * The editor's body (Annex J §4): every block of the kind in order —
 * prompts with their question, example and helper line; the rating,
 * difficulty and cue choices; and the side actions, each with an Undo toast.
 * Required prompts are marked with "Required" text; "Answer at least one of
 * these." sits above a kind's any-of group while none is answered.
 */
export function JournalBlocks({ ctx }: { ctx: JournalBlockContext }) {
	const { t } = useT();
	const { kind, habit, editor } = ctx;
	const blocks = journalBlocks(kind, habit);
	const anyOf = journalAnyOf(kind, habit);
	const missingAnyOf = editor.check.missing.includes("anyOf");
	const firstAnyOf = blocks.find((b) => b.type === "prompt" && anyOf.includes(b.prompt.id));

	return (
		// A block with nothing to show yet (Goldilocks before a choice) leaves no gap behind.
		<div className="flex flex-col gap-8 [&>:empty]:hidden">
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
						content = <PlanBlock ctx={ctx} />;
						break;
					case "goldilocks":
						content = <GoldilocksBlock ctx={ctx} />;
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
					<div key={blockKey(block, index)} className="flex flex-col gap-3">
						{missingAnyOf && block === firstAnyOf ? (
							<p className="flex items-center gap-2 text-ink-muted text-small">
								<Info aria-hidden="true" className="size-4 shrink-0" />
								{t("journal.anyOf")}
							</p>
						) : null}
						{content}
					</div>
				);
			})}
		</div>
	);
}
