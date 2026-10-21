import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	type AnyRepeat,
	type DayKey,
	type RepeatRule,
	type RepeatUnit,
	type Task,
	type TaskLog,
	type Weekday,
	addMonths,
	isKnownRule,
	maxDay,
	nextDatesLabel,
	orderedWeekdays,
	presetKeyOf,
	presetLabel,
	repeatLabel,
	repeatPresets,
	upcomingOccurrences,
	weekdayOf,
} from "@atomic/core";
import { useToday } from "@atomic/core/react";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { CalendarDays, Check, ChevronDown, Minus, Plus, Repeat } from "lucide-react";
import { type ReactNode, type Ref, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { DatePicker } from "../ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { IconButton } from "../ui/icon-button";
import { MenuContent, MenuSeparator } from "../ui/menu";
import { SegmentedControl } from "../ui/segmented";
import { taskDateLabel } from "./task-date";

/**
 * The repeat picker (Annex T §4.2): a chip whose menu lists the presets
 * relative to the start ("Weekly on Tue", "Monthly on the 20th", "Every year
 * on Oct 20") and "Custom…". In a form, Custom expands an inline fieldset
 * (mode, every + unit, weekdays, day of the month, ends) with a live preview
 * of the next dates; `compact` (quick add) edits it in a small dialog.
 */

type EndChoice = "never" | "on" | "after";
type Mode = "schedule" | "after";
type PresetKey = ReturnType<typeof presetKeyOf>;

const MAX_EVERY: Record<RepeatUnit, number> = { days: 365, weeks: 52, months: 120 };
const DEFAULT_COUNT = 10;

const dayOfMonth = (day: DayKey) => Number(day.slice(8, 10));
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** A throwaway series for previews: the rule on `start`, with the edited task's logs if any. */
function previewSeries(rule: RepeatRule, start: DayKey, base?: Task): Task {
	// Only id, date, createdAt, repeat and completedAt are read (`upcomingOccurrences`).
	return {
		...(base ?? ({ id: "preview", createdAt: 0, habitId: null } as unknown as Task)),
		repeat: rule,
		date: start,
		completedAt: null,
	};
}

/** The next `n` dates a rule gives from `start` ("Next: Oct 14, Oct 15, Oct 16"). */
export function useNextDates(
	rule: AnyRepeat | null,
	start: DayKey,
	opts: { task?: Task; logs?: readonly TaskLog[]; n?: number } = {},
): DayKey[] {
	const today = useToday();
	const { task, logs, n = 3 } = opts;
	return useMemo(() => {
		if (!isKnownRule(rule)) return [];
		return upcomingOccurrences(previewSeries(rule, start, task), logs ?? [], today, n);
	}, [rule, start, task, logs, today, n]);
}

/** An extra preset beside the built-in ones ("Same days as the habit"). */
export interface ExtraRepeatPreset {
	key: string;
	label: string;
	rule: RepeatRule;
}

/** Same schedule (type, interval, days, ends), ignoring unknown keys and key order. */
export function sameRule(a: AnyRepeat | null, b: AnyRepeat | null): boolean {
	if (a === b) return true;
	if (!isKnownRule(a) || !isKnownRule(b) || a.type !== b.type) return false;
	const shape = (rule: RepeatRule) =>
		JSON.stringify([
			rule.every ?? 1,
			rule.type === "weeks" ? [...rule.days].sort() : null,
			rule.type === "months" ? rule.day : null,
			rule.type === "after" ? (rule.unit ?? "days") : null,
			rule.until ?? null,
			rule.count ?? null,
		]);
	return shape(a) === shape(b);
}

export interface RepeatFieldProps {
	value: AnyRepeat | null;
	onChange(rule: RepeatRule | null): void;
	/** The series start: presets are relative to it, and it anchors the preview. */
	start: DayKey;
	weekStartsOn: Weekday;
	/** Chip only (quick add): "Custom…" opens a small dialog instead of the inline fieldset. */
	compact?: boolean;
	/** Read-only (a rule from a newer version of Atomic). */
	disabled?: boolean;
	/** The series being edited, so the preview starts from its open occurrence. */
	task?: Task;
	logs?: readonly TaskLog[];
	/** Listed first in the menu ("Same days as the habit"). */
	extraPresets?: readonly ExtraRepeatPreset[];
	/** The chip's text without a rule (default "Repeat"; setup tasks say "Once"). */
	noneLabel?: string;
	/** The chip's accessible name prefix (default "Repeat"). */
	label?: string;
	className?: string;
}

export function RepeatField({
	value,
	onChange,
	start,
	weekStartsOn,
	compact,
	disabled,
	task,
	logs,
	extraPresets,
	noneLabel,
	label: fieldLabel,
	className,
}: RepeatFieldProps) {
	const { t } = useT();
	const ws = weekStartsOn === 0 ? 0 : 1;
	const presets = useMemo(() => repeatPresets(start, ws), [start, ws]);
	const known = isKnownRule(value) ? value : null;
	const extra = extraPresets?.find((preset) => sameRule(preset.rule, value));
	const presetKey: string = extra ? extra.key : presetKeyOf(value, start);
	const [customOpen, setCustomOpen] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const editorRef = useRef<HTMLFieldSetElement>(null);
	const focusEditor = useRef(false);
	const next = useNextDates(known, start, { task, logs });
	const label = value ? repeatLabel(value, t, { start, weekStartsOn }) : null;

	// Repeat turned off elsewhere (e.g. the series became a one-off): fold the editor.
	useEffect(() => {
		if (!known) setCustomOpen(false);
	}, [known]);

	const pick = (key: PresetKey) => {
		if (key === "custom") {
			if (compact) {
				setDialogOpen(true);
				return;
			}
			if (!known) onChange(presets.find((p) => p.key === "weekly")?.rule ?? null);
			setCustomOpen(true);
			focusEditor.current = true;
			return;
		}
		setCustomOpen(false);
		onChange(presets.find((p) => p.key === key)?.rule ?? null);
	};

	const chip = (
		<Chip
			selected={false}
			disabled={disabled}
			aria-label={`${fieldLabel ?? t("repeat.label")}: ${label ?? noneLabel ?? t("repeat.none")}`}
			className="h-auto min-h-8 max-w-full self-start whitespace-normal py-1 text-left"
		>
			<Repeat aria-hidden="true" className={cn(known && "text-accent-text")} />
			<span className={cn("min-w-0 break-words", known && "text-ink")}>
				{label ?? noneLabel ?? t("repeat.label")}
			</span>
			{disabled ? null : <ChevronDown aria-hidden="true" className="-mr-0.5 text-ink-subtle" />}
		</Chip>
	);

	return (
		<div className={cn("flex min-w-0 flex-col gap-2", className)}>
			{disabled ? (
				<div>{chip}</div>
			) : (
				<MenuPrimitive.Root modal={false}>
					<MenuPrimitive.Trigger asChild>{chip}</MenuPrimitive.Trigger>
					<MenuContent
						align="start"
						className="min-w-56"
						onCloseAutoFocus={(event) => {
							if (!focusEditor.current) return;
							// "Custom…" expanded the editor: take focus there, not back to the chip.
							focusEditor.current = false;
							event.preventDefault();
							requestAnimationFrame(() =>
								editorRef.current
									?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
									?.focus(),
							);
						}}
					>
						<MenuPrimitive.RadioGroup value={presetKey}>
							{extraPresets?.map((preset) => (
								<RadioItem
									key={preset.key}
									value={preset.key}
									onSelect={() => {
										setCustomOpen(false);
										onChange(preset.rule);
									}}
								>
									{preset.label}
								</RadioItem>
							))}
							{extraPresets?.length ? <MenuSeparator /> : null}
							{presets.map((preset) => (
								<RadioItem key={preset.key} value={preset.key} onSelect={() => pick(preset.key)}>
									{presetLabel(preset, t, start, weekStartsOn)}
								</RadioItem>
							))}
							<MenuSeparator />
							<RadioItem value="custom" onSelect={() => pick("custom")}>
								{t("repeat.custom")}
							</RadioItem>
						</MenuPrimitive.RadioGroup>
					</MenuContent>
				</MenuPrimitive.Root>
			)}
			{!compact && known && customOpen ? (
				<RepeatEditor
					ref={editorRef}
					value={known}
					onChange={onChange}
					start={start}
					weekStartsOn={weekStartsOn}
					next={next}
				/>
			) : null}
			{compact ? null : (
				// Always mounted so screen readers hear the dates change (start date, rule).
				<p
					aria-live="polite"
					className={cn("text-ink-muted text-small", !(known && !customOpen) && "sr-only")}
				>
					{known && !customOpen ? nextDatesLabel(next, t) : ""}
				</p>
			)}
			{compact ? (
				<RepeatDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					value={known}
					onDone={onChange}
					start={start}
					weekStartsOn={weekStartsOn}
					fallback={presets.find((p) => p.key === "weekly")?.rule ?? null}
				/>
			) : null}
		</div>
	);
}

function RadioItem({
	value,
	onSelect,
	children,
}: {
	value: string;
	onSelect(): void;
	children: ReactNode;
}) {
	return (
		<MenuPrimitive.RadioItem
			value={value}
			onSelect={onSelect}
			className="flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-sm py-1.5 pr-3 pl-2.5 text-ink text-small outline-none transition-colors data-[highlighted]:bg-hover"
		>
			<span className="grid size-4 shrink-0 place-items-center text-accent-text">
				<MenuPrimitive.ItemIndicator>
					<Check className="size-4" strokeWidth={2.5} />
				</MenuPrimitive.ItemIndicator>
			</span>
			<span className="min-w-0 flex-1">{children}</span>
		</MenuPrimitive.RadioItem>
	);
}

/** Quick add's "Custom…": the same editor in a small dialog, applied on Done. */
function RepeatDialog({
	open,
	onOpenChange,
	value,
	onDone,
	start,
	weekStartsOn,
	fallback,
}: {
	open: boolean;
	onOpenChange(open: boolean): void;
	value: RepeatRule | null;
	onDone(rule: RepeatRule): void;
	start: DayKey;
	weekStartsOn: Weekday;
	fallback: RepeatRule | null;
}) {
	const { t } = useT();
	const [draft, setDraft] = useState<RepeatRule | null>(value ?? fallback);
	const next = useNextDates(draft, start);
	// Each opening starts from the current rule.
	useEffect(() => {
		if (open) setDraft(value ?? fallback);
	}, [open, value, fallback]);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="sm">
				<DialogHeader title={t("repeat.customTitle")} />
				<DialogBody>
					{draft ? (
						<RepeatEditor
							value={draft}
							onChange={setDraft}
							start={start}
							weekStartsOn={weekStartsOn}
							next={next}
							bare
						/>
					) : null}
				</DialogBody>
				<DialogFooter>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						disabled={!draft}
						onClick={() => {
							if (draft) onDone(draft);
							onOpenChange(false);
						}}
					>
						{t("common.done")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

interface RepeatEditorProps {
	value: RepeatRule;
	onChange(rule: RepeatRule): void;
	start: DayKey;
	weekStartsOn: Weekday;
	/** The next dates under this rule (`useNextDates`). */
	next: readonly DayKey[];
	/** No frame (inside its own dialog). */
	bare?: boolean;
	ref?: Ref<HTMLFieldSetElement>;
}

/**
 * The custom rule editor: mode, every + unit, weekdays (at least one), day
 * of the month (29–31 clamp to the month's last day), ends (never, on a
 * date, after N times) and an `aria-live` summary with the next dates.
 * Unknown keys of the current rule (a newer client's, `endedAt`) are kept
 * while its type stays the same.
 */
export function RepeatEditor({
	value,
	onChange,
	start,
	weekStartsOn,
	next,
	bare,
	ref,
}: RepeatEditorProps) {
	const { t } = useT();
	const today = useToday();
	const legendId = useId();
	const mode: Mode = value.type === "after" ? "after" : "schedule";
	const unit: RepeatUnit = value.type === "after" ? (value.unit ?? "days") : value.type;
	const every = Math.max(1, Math.floor(value.every ?? 1));
	const ends: EndChoice = value.until ? "on" : value.count != null ? "after" : "never";
	// What the other units and end choices last held, so switching back restores it.
	const memory = useRef({
		days: value.type === "weeks" ? [...value.days] : [weekdayOf(start)],
		day: value.type === "months" ? value.day : dayOfMonth(start),
		until: value.until ?? addMonths(maxDay(start, today), 1),
		count: value.count ?? DEFAULT_COUNT,
	});
	if (value.type === "weeks") memory.current.days = [...value.days];
	if (value.type === "months") memory.current.day = value.day;
	if (value.until) memory.current.until = value.until;
	if (value.count != null) memory.current.count = value.count;

	const build = (
		changes: Partial<{ mode: Mode; unit: RepeatUnit; every: number; ends: EndChoice }> = {},
	): RepeatRule => {
		const m = changes.mode ?? mode;
		const u = changes.unit ?? unit;
		const e = changes.ends ?? ends;
		const end = {
			until: e === "on" ? memory.current.until : null,
			count: e === "after" ? memory.current.count : null,
		};
		const type = m === "after" ? "after" : u;
		const keep = (value.type === type ? value : {}) as Record<string, unknown>;
		const n = clamp(changes.every ?? every, 1, m === "after" ? 365 : MAX_EVERY[u]);
		if (m === "after") return { ...keep, type: "after", every: n, unit: u, ...end } as RepeatRule;
		if (u === "days") return { ...keep, type: "days", every: n, ...end } as RepeatRule;
		if (u === "weeks") {
			return {
				...keep,
				type: "weeks",
				every: n,
				days: memory.current.days,
				weekStart: (keep.weekStart as 0 | 1 | undefined) ?? (weekStartsOn === 0 ? 0 : 1),
				...end,
			} as RepeatRule;
		}
		return { ...keep, type: "months", every: n, day: memory.current.day, ...end } as RepeatRule;
	};

	const toggleDay = (day: Weekday) => {
		const days = memory.current.days;
		const has = days.includes(day);
		if (has && days.length <= 1) return;
		memory.current.days = has
			? days.filter((d) => d !== day)
			: [...days, day].sort((a, b) => a - b);
		onChange(build());
	};

	const weeks = mode === "schedule" && unit === "weeks";
	const months = mode === "schedule" && unit === "months";
	const lastWeekday = memory.current.days.length <= 1;

	return (
		<fieldset
			ref={ref}
			aria-labelledby={legendId}
			className={cn(
				"flex min-w-0 flex-col gap-4",
				!bare && "rounded-xl border border-line bg-sunken/50 p-3 sm:p-4",
			)}
		>
			<legend id={legendId} className="sr-only">
				{t("repeat.label")}
			</legend>
			<SegmentedControl<Mode>
				label={t("repeat.label")}
				value={mode}
				onChange={(next) => onChange(build({ mode: next }))}
				fullWidth
				size="sm"
				options={[
					{ value: "schedule", label: t("repeat.mode.schedule") },
					{ value: "after", label: t("repeat.mode.after") },
				]}
			/>
			<div className="flex flex-col gap-2">
				<span className="font-medium text-ink text-small">{t("repeat.every")}</span>
				<div className="flex flex-wrap items-center gap-2">
					<RepeatStepper
						label={t("repeat.every")}
						value={every}
						min={1}
						max={mode === "after" ? 365 : MAX_EVERY[unit]}
						onChange={(n) => onChange(build({ every: n }))}
					/>
					<SegmentedControl<RepeatUnit>
						label={t("repeat.every")}
						value={unit}
						onChange={(next) => onChange(build({ unit: next }))}
						size="sm"
						options={[
							{ value: "days", label: t("repeat.unit.days") },
							{ value: "weeks", label: t("repeat.unit.weeks") },
							{ value: "months", label: t("repeat.unit.months") },
						]}
					/>
				</div>
			</div>
			{weeks ? (
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-2 font-medium text-ink text-small">{t("repeat.onDays")}</legend>
					<div className="grid grid-cols-7 gap-1">
						{orderedWeekdays(weekStartsOn).map((day) => {
							const pressed = memory.current.days.includes(day);
							const locked = pressed && lastWeekday;
							return (
								<button
									key={day}
									type="button"
									aria-pressed={pressed}
									aria-disabled={locked || undefined}
									aria-label={t.weekdayName(day, "long")}
									onClick={() => toggleDay(day)}
									className={cn(
										"h-10 min-w-0 rounded-md border font-medium text-small capitalize transition-colors",
										pressed
											? "border-ink bg-ink text-bg"
											: "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
										locked && "cursor-default",
									)}
								>
									{t.weekdayName(day, "short")}
								</button>
							);
						})}
					</div>
				</fieldset>
			) : null}
			{months ? (
				<div className="flex flex-col gap-2">
					<span className="font-medium text-ink text-small">{t("repeat.onDay")}</span>
					<RepeatStepper
						label={t("repeat.onDay")}
						value={memory.current.day}
						min={1}
						max={31}
						onChange={(day) => {
							memory.current.day = day;
							onChange(build());
						}}
					/>
					{memory.current.day >= 29 ? (
						<p className="text-ink-subtle text-small">{t("repeat.clampHint")}</p>
					) : null}
				</div>
			) : null}
			<div className="flex flex-col gap-2">
				<span className="font-medium text-ink text-small">{t("repeat.ends")}</span>
				<SegmentedControl<EndChoice>
					label={t("repeat.ends")}
					value={ends}
					onChange={(next) => onChange(build({ ends: next }))}
					fullWidth
					size="sm"
					options={[
						{ value: "never", label: t("repeat.ends.never") },
						{ value: "on", label: t("repeat.ends.on") },
						{ value: "after", label: t("repeat.ends.after") },
					]}
				/>
				{ends === "on" ? (
					<div>
						<DatePicker
							value={memory.current.until}
							onChange={(day) => {
								memory.current.until = day;
								onChange(build());
							}}
						>
							<Chip
								selected={false}
								aria-label={`${t("repeat.ends.on")}: ${t.formatDayLong(memory.current.until)}`}
							>
								<CalendarDays aria-hidden="true" />
								<span className="text-ink">{taskDateLabel(memory.current.until, today, t)}</span>
							</Chip>
						</DatePicker>
					</div>
				) : null}
				{ends === "after" ? (
					<div className="flex items-center gap-2">
						<RepeatStepper
							label={t("repeat.count")}
							value={memory.current.count}
							min={1}
							max={999}
							onChange={(count) => {
								memory.current.count = count;
								onChange(build());
							}}
						/>
						<span className="text-ink-muted text-small">
							{t.tp("repeat.timesUnit", memory.current.count)}
						</span>
					</div>
				) : null}
			</div>
			<div aria-live="polite" className="flex flex-col gap-0.5 border-line border-t pt-3">
				<p className="font-medium text-ink text-small">
					{repeatLabel(value, t, { start, weekStartsOn })}
				</p>
				<p className="text-ink-muted text-small">{nextDatesLabel(next, t)}</p>
			</div>
		</fieldset>
	);
}

/** −/+ around a small number field, as in the habit editor; typing commits on blur or Enter. */
function RepeatStepper({
	value,
	min,
	max,
	onChange,
	label,
}: {
	value: number;
	min: number;
	max: number;
	onChange(value: number): void;
	label: string;
}) {
	const { t } = useT();
	const [text, setText] = useState(String(value));
	useEffect(() => setText(String(value)), [value]);
	const commit = () => {
		const parsed = Number.parseInt(text, 10);
		const next = Number.isFinite(parsed) ? clamp(parsed, min, max) : value;
		setText(String(next));
		if (next !== value) onChange(next);
	};
	return (
		// biome-ignore lint/a11y/useSemanticElements: a labelled group of a field and its two buttons.
		<div
			role="group"
			aria-label={label}
			className="inline-flex h-11 shrink-0 items-center gap-1 self-start rounded-full border border-line bg-surface p-1"
		>
			<IconButton
				label={t("habit.decrement")}
				size="sm"
				disabled={value <= min}
				onClick={() => onChange(value - 1)}
			>
				<Minus />
			</IconButton>
			<input
				type="text"
				inputMode="numeric"
				aria-label={label}
				value={text}
				onChange={(event) => {
					const raw = event.target.value.replace(/[^0-9]/g, "").slice(0, String(max).length);
					setText(raw);
					const parsed = Number.parseInt(raw, 10);
					if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
				}}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault();
						onChange(clamp(value + (event.key === "ArrowUp" ? 1 : -1), min, max));
					}
				}}
				className="w-11 rounded-sm bg-transparent text-center font-semibold text-ink tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
			<IconButton
				label={t("habit.increment")}
				size="sm"
				disabled={value >= max}
				onClick={() => onChange(value + 1)}
			>
				<Plus />
			</IconButton>
		</div>
	);
}
