import {
	EMOJI_CHOICES,
	HABIT_COLORS,
	type HabitColor,
	type HabitKind,
	TIMES_OF_DAY,
	type TimeOfDay,
	type Weekday,
	orderedWeekdays,
} from "@atomic/core";
import { useAtomic } from "@atomic/core/react";
import { habitColor } from "@atomic/core/theme";
import { Check, Minus, Plus, ShieldOff, Sprout, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useT } from "@/lib/messages";
import { useColorScheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Field, Input } from "../ui/field";
import { IconButton } from "../ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { SegmentedControl } from "../ui/segmented";
import type { HabitDraft } from "./draft";

export type DraftUpdate = (patch: Partial<HabitDraft>) => void;

export function KindToggle({ value, onChange }: { value: HabitKind; onChange(kind: HabitKind): void }) {
	const { t } = useT();
	const options: { kind: HabitKind; icon: ReactNode; hint: string }[] = [
		{ kind: "build", icon: <Sprout />, hint: t("form.kind.buildHint") },
		{ kind: "break", icon: <ShieldOff />, hint: t("form.kind.breakHint") },
	];
	return (
		<div role="radiogroup" aria-label={t("form.kind")} className="grid grid-cols-2 gap-2.5">
			{options.map((option) => {
				const selected = value === option.kind;
				return (
					<button
						key={option.kind}
						type="button"
						role="radio"
						aria-checked={selected}
						onClick={() => onChange(option.kind)}
						className={cn(
							"flex items-start gap-3 rounded-lg border bg-surface p-3.5 text-left transition-[border-color,box-shadow] duration-(--atomic-duration-fast)",
							selected ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:border-line-strong",
						)}
					>
						<span
							className={cn(
								"grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-[18px]",
								selected ? "bg-accent text-on-accent" : "bg-sunken text-ink-muted",
							)}
						>
							{option.icon}
						</span>
						<span className="min-w-0">
							<span className="block font-semibold text-ink">{t(`form.kind.${option.kind}`)}</span>
							<span className="block text-ink-muted text-small leading-snug">{option.hint}</span>
						</span>
					</button>
				);
			})}
		</div>
	);
}

export function EmojiPicker({ value, color, onChange }: { value: string; color: HabitColor; onChange(emoji: string): void }) {
	const { t, at } = useT();
	const scheme = useColorScheme();
	const [open, setOpen] = useState(false);
	const [custom, setCustom] = useState("");
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`${t("form.emoji")}: ${value}`}
					className="grid size-11 shrink-0 place-items-center rounded-md border border-line font-emoji text-2xl transition-colors hover:border-line-strong"
					style={{ background: habitColor(color, scheme).soft }}
				>
					{value}
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-[296px]">
				<p className="mb-2 font-medium text-ink text-small">{at("form.emojiPick")}</p>
				<div className="grid grid-cols-8 gap-1">
					{EMOJI_CHOICES.map((emoji) => (
						<button
							key={emoji}
							type="button"
							aria-label={emoji}
							aria-pressed={emoji === value}
							onClick={() => {
								onChange(emoji);
								setOpen(false);
							}}
							className={cn(
								"grid size-8 place-items-center rounded-sm font-emoji text-lg transition-colors hover:bg-hover",
								emoji === value && "bg-accent-soft",
							)}
						>
							{emoji}
						</button>
					))}
				</div>
				<form
					className="mt-3 flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						const chosen = [...custom.trim()].slice(0, 2).join("");
						if (chosen) {
							onChange(chosen);
							setCustom("");
							setOpen(false);
						}
					}}
				>
					<Input
						value={custom}
						onChange={(event) => setCustom(event.target.value)}
						placeholder={at("form.customEmoji")}
						aria-label={at("form.customEmoji")}
						maxLength={16}
						className="h-9 text-small"
					/>
				</form>
			</PopoverContent>
		</Popover>
	);
}

export function ColorPicker({ value, onChange }: { value: HabitColor; onChange(color: HabitColor): void }) {
	const { t, at } = useT();
	const scheme = useColorScheme();
	return (
		<div role="radiogroup" aria-label={t("form.color")} className="flex flex-wrap gap-2">
			{HABIT_COLORS.map((color) => {
				const selected = value === color;
				const fill = habitColor(color, scheme).fill;
				return (
					<button
						key={color}
						type="button"
						role="radio"
						aria-checked={selected}
						aria-label={at(`color.${color}`)}
						onClick={() => onChange(color)}
						className={cn(
							"grid size-8 place-items-center rounded-full transition-transform duration-(--atomic-duration-fast) hover:scale-110",
							selected && "ring-2 ring-offset-2 ring-offset-surface",
						)}
						style={{ background: fill, ["--tw-ring-color" as string]: fill }}
					>
						{selected ? <Check className="size-4 text-white" strokeWidth={3} /> : null}
					</button>
				);
			})}
		</div>
	);
}

export function Stepper({
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
	return (
		<div className="inline-flex h-11 items-center gap-1 rounded-full border border-line bg-sunken/60 p-1">
			<IconButton label={t("habit.decrement")} size="sm" disabled={value <= min} onClick={() => onChange(value - 1)}>
				<Minus />
			</IconButton>
			<input
				type="number"
				inputMode="numeric"
				aria-label={label}
				value={value}
				min={min}
				max={max}
				onChange={(event) => {
					const next = Number(event.target.value);
					if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))));
				}}
				className="w-12 bg-transparent text-center font-semibold text-ink tabular-nums outline-none [appearance:textfield] focus-visible:outline-none [&::-webkit-inner-spin-button]:appearance-none"
			/>
			<IconButton label={t("habit.increment")} size="sm" disabled={value >= max} onClick={() => onChange(value + 1)}>
				<Plus />
			</IconButton>
		</div>
	);
}

export function FrequencyField({ draft, update }: { draft: HabitDraft; update: DraftUpdate }) {
	const { t, at } = useT();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const toggleDay = (day: Weekday) => {
		const has = draft.days.includes(day);
		const days = has ? draft.days.filter((d) => d !== day) : [...draft.days, day];
		if (days.length) update({ days });
	};
	return (
		<div className="flex flex-col gap-3">
			<span className="font-medium text-ink text-small">{t("form.schedule")}</span>
			<SegmentedControl
				label={t("form.schedule")}
				value={draft.scheduleType}
				onChange={(scheduleType) => update({ scheduleType })}
				fullWidth
				options={[
					{ value: "daily", label: t("form.schedule.daily") },
					{ value: "weekdays", label: t("form.schedule.weekdays") },
					{ value: "weekly", label: t("form.schedule.weekly") },
				]}
			/>
			{draft.scheduleType === "weekdays" ? (
				<fieldset className="flex flex-col gap-2">
					<legend className="sr-only">{at("form.daysLabel")}</legend>
					<div className="grid grid-cols-7 gap-1.5">
						{orderedWeekdays(weekStartsOn).map((day) => {
							const selected = draft.days.includes(day);
							return (
								<button
									key={day}
									type="button"
									aria-pressed={selected}
									aria-label={t.weekdayName(day, "long")}
									onClick={() => toggleDay(day)}
									className={cn(
										"h-10 rounded-md border font-medium text-small capitalize transition-colors",
										selected ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-muted hover:border-line-strong",
									)}
								>
									{t.weekdayName(day, "short")}
								</button>
							);
						})}
					</div>
				</fieldset>
			) : null}
			{draft.scheduleType === "weekly" ? (
				<div className="flex items-center gap-3">
					<Stepper value={draft.times} min={1} max={7} onChange={(times) => update({ times })} label={at("form.timesLabel")} />
					<span className="text-ink-muted text-small">{t.tp("form.schedule.timesPerWeek", draft.times)}</span>
				</div>
			) : null}
		</div>
	);
}

export function TimeOfDayField({ value, onChange }: { value: TimeOfDay; onChange(value: TimeOfDay): void }) {
	const { t } = useT();
	return (
		<div className="flex flex-col gap-1.5">
			<span className="font-medium text-ink text-small">{t("form.timeOfDay")}</span>
			<SegmentedControl
				label={t("form.timeOfDay")}
				value={value}
				onChange={onChange}
				fullWidth
				options={TIMES_OF_DAY.map((time) => ({ value: time, label: t(`time.${time}`) }))}
			/>
		</div>
	);
}

export function CueTimeField({ value, onChange }: { value: string; onChange(value: string): void }) {
	const { t, at } = useT();
	return (
		<Field label={t("form.cueTime")} optional={t("common.optional")}>
			{(props) => (
				<div className="relative">
					<Input {...props} type="time" value={value} onChange={(event) => onChange(event.target.value)} className="pr-10" />
					{value ? (
						<IconButton
							label={at("form.clearTime")}
							size="sm"
							tooltip={false}
							className="absolute top-1.5 right-1.5"
							onClick={() => onChange("")}
						>
							<X />
						</IconButton>
					) : null}
				</div>
			)}
		</Field>
	);
}

interface TextFieldProps {
	label: string;
	value: string;
	onChange(value: string): void;
	placeholder?: string;
	hint?: string;
	prefix?: string;
	maxLength?: number;
	optional?: boolean;
	autoFocus?: boolean;
}

export function DraftTextField({
	label,
	value,
	onChange,
	placeholder,
	hint,
	prefix,
	maxLength = 160,
	optional = true,
	autoFocus,
}: TextFieldProps) {
	const { t } = useT();
	return (
		<Field label={label} hint={hint} optional={optional ? t("common.optional") : undefined}>
			{(props) =>
				prefix ? (
					<div className="flex items-center rounded-md border border-line bg-sunken/60 pl-3.5 transition-colors focus-within:border-accent focus-within:bg-surface focus-within:ring-3 focus-within:ring-accent/15 hover:border-line-strong">
						<span className="shrink-0 text-ink-muted">{prefix}</span>
						<input
							{...props}
							value={value}
							maxLength={maxLength}
							placeholder={placeholder}
							onChange={(event) => onChange(event.target.value)}
							className="h-11 min-w-0 flex-1 bg-transparent px-2 text-ink outline-none focus-visible:outline-none"
						/>
					</div>
				) : (
					<Input
						{...props}
						value={value}
						maxLength={maxLength}
						placeholder={placeholder}
						// biome-ignore lint/a11y/noAutofocus: first field of a wizard step.
						autoFocus={autoFocus}
						onChange={(event) => onChange(event.target.value)}
					/>
				)
			}
		</Field>
	);
}
