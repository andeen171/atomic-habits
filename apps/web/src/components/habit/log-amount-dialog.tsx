import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { LOG_AMOUNT_MAX, amountLabel, useHabitLogger } from "@/lib/use-habit-logger";
import {
	type DayKey,
	type Habit,
	MONTH_DAY_CAP,
	getLog,
	monthAmount,
	targetOn,
} from "@atomic/core";
import { useAtomic, useText, useToday } from "@atomic/core/react";
import {
	type FormEvent,
	type RefObject,
	type SyntheticEvent,
	useId,
	useRef,
	useState,
} from "react";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { NumberField } from "../ui/number-field";
import { displayHabit } from "./display-habit";
import { HabitRingGraphic } from "./habit-ring";

export interface LogAmountDialogProps {
	habit: Habit;
	day: DayKey;
	open: boolean;
	onOpenChange(open: boolean): void;
}

/** Events from the portaled dialog must not reach a clickable host row (React bubbles through portals). */
const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * "Log amount…" (spec §5.2, D11): set a day's count directly, 0–10,000, with
 * the month cap as the hint ("Up to 20 pages count toward this month's
 * goal."). Saving shows an Undo toast.
 */
export function LogAmountDialog({ habit, day, open, onOpenChange }: LogAmountDialogProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				size="sm"
				onClick={stop}
				onPointerDown={stop}
				onContextMenu={stop}
				// Start in the number (selected, so typing replaces it), not on the "−" button.
				onOpenAutoFocus={(event) => {
					const input = inputRef.current;
					if (!input) return;
					event.preventDefault();
					input.focus();
					input.select();
				}}
			>
				<LogAmountForm
					habit={habit}
					day={day}
					inputRef={inputRef}
					onDone={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}

function LogAmountForm({
	habit,
	day,
	inputRef,
	onDone,
}: {
	habit: Habit;
	day: DayKey;
	inputRef: RefObject<HTMLInputElement | null>;
	onDone(): void;
}) {
	const { t } = useT();
	const text = useText();
	const today = useToday();
	const style = useHabitStyle(habit.color);
	const { logAmount } = useHabitLogger();
	const current = useAtomic((s) => getLog(s, habit.id, day)?.count ?? 0);
	const [value, setValue] = useState<number | null>(current);
	const hintId = useId();
	const fieldId = useId();
	const target = targetOn(habit, day);
	const amount = value ?? 0;
	const name = text.habit(habit, "name");
	const shown = displayHabit(habit, text);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		logAmount(habit, day, amount);
		onDone();
	};

	return (
		<form onSubmit={submit} className="flex min-h-0 flex-col">
			<DialogHeader
				title={t("habit.logAmountTitle", { habit: name })}
				description={t.formatRelativeDay(day, today)}
			/>
			<DialogBody className="flex flex-col gap-4">
				<div style={style} className="flex items-center gap-3 rounded-lg bg-sunken/70 px-3 py-2.5">
					<HabitRingGraphic
						habit={habit}
						progress={Math.min(1, amount / target)}
						state={amount >= target ? "done" : amount > 0 ? "partial" : "pending"}
						extra={Math.max(0, amount - target)}
						size={36}
					/>
					<div className="min-w-0 flex-1">
						<p className="truncate font-medium text-ink text-small">{name}</p>
						<p className="text-ink-muted text-tiny tabular-nums" aria-live="polite">
							{amountLabel(shown, amount, t)}
						</p>
					</div>
				</div>
				<div className="flex flex-col gap-1.5">
					<label htmlFor={fieldId} className="font-medium text-ink text-small">
						{t("habit.logAmountLabel", { date: t.formatDayShort(day) })}
					</label>
					<NumberField
						ref={inputRef}
						id={fieldId}
						className="min-w-0 flex-1"
						aria-describedby={hintId}
						value={value}
						onChange={setValue}
						min={0}
						max={LOG_AMOUNT_MAX}
						stepper
						suffix={habit.unit ?? undefined}
					/>
					<p id={hintId} className="text-ink-muted text-small">
						{t("habit.logAmountHint", {
							cap: monthAmount(shown, MONTH_DAY_CAP * target, t),
						})}
					</p>
				</div>
			</DialogBody>
			<DialogFooter>
				<Button variant="secondary" onClick={onDone}>
					{t("common.cancel")}
				</Button>
				<Button type="submit">{t("common.save")}</Button>
			</DialogFooter>
		</form>
	);
}
