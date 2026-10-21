import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { useHabitLogger } from "@/lib/use-habit-logger";
import { cn } from "@/lib/utils";
import {
	type AgendaItem,
	type DayKey,
	canExceedTarget,
	isTrackerActive,
	isTrackerDay,
	monthPaceHint,
	progressLabel,
	targetOn,
} from "@atomic/core";
import { useActions, useMonthGoal, useText, useToday, useTrackerDayLine } from "@atomic/core/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Minus, Plus, StickyNote } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type MouseEvent, type PointerEvent, useId, useRef, useState } from "react";
import { IconButton } from "../ui/icon-button";
import { Tip } from "../ui/tooltip";
import { useDisplayHabit } from "./display-habit";
import { HabitActionsMenu } from "./habit-actions-menu";
import { HabitRingButton } from "./habit-ring";
import { StreakChip } from "./streak-chip";

interface HabitRowProps {
	item: AgendaItem;
	day: DayKey;
	/** Weekly habits whose quota is met are shown dimmed. */
	dimmed?: boolean;
}

const LONG_PRESS_MS = 480;

export function HabitRow({ item, day, dimmed }: HabitRowProps) {
	const { habit, count, progress, state, streak, log, week } = item;
	const { t, at } = useT();
	const text = useText();
	const actions = useActions();
	const navigate = useNavigate();
	const today = useToday();
	const { tap, extraRep } = useHabitLogger();
	const nameId = useId();
	const style = useHabitStyle(habit.color);
	/** Name and unit in the content language, for labels only. */
	const shown = useDisplayHabit(habit);
	const [menuOpen, setMenuOpen] = useState(false);
	const [shake, setShake] = useState(false);
	const [floats, setFloats] = useState<number[]>([]);
	const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** Set when a long-press opened the menu, so the trailing click doesn't navigate. */
	const longPressed = useRef(false);
	const isBreak = habit.kind === "break";
	const name = text.habit(habit, "name");
	const target = targetOn(habit, day);
	const counted = !isBreak && target > 1;
	const trackerActive = isTrackerActive(habit);
	const trackerDay = isTrackerDay(habit, day);
	const dayLine = useTrackerDayLine(trackerDay ? habit : undefined, day);
	const isToday = day === today;
	// Pace toward this month's goal ("+3 pages/day wins October"), today only (spec §5.2).
	const month = useMonthGoal(!isBreak && isToday ? habit : undefined);
	const pace = month?.kind === "build" ? monthPaceHint(month, shown, today, t) : null;
	// The visible "+1" once the target is met (D11): count habits whose extra reps count.
	const showExtra = counted && !trackerDay && count >= target && canExceedTarget(habit);

	const onRingClick = (event: MouseEvent) => {
		event.stopPropagation();
		const outcome = tap(habit, day);
		if (outcome === "already-done") {
			setShake(true);
			setTimeout(() => setShake(false), 400);
		} else if (outcome === "completed" || outcome === "progress") {
			const id = Date.now();
			setFloats((list) => [...list, id]);
			setTimeout(() => setFloats((list) => list.filter((f) => f !== id)), 900);
		}
	};

	const clearPress = () => {
		if (pressTimer.current) clearTimeout(pressTimer.current);
		pressTimer.current = null;
	};

	const onPointerDown = (event: PointerEvent) => {
		if (event.pointerType !== "touch") return;
		clearPress();
		longPressed.current = false;
		pressTimer.current = setTimeout(() => {
			pressTimer.current = null;
			longPressed.current = true;
			setMenuOpen(true);
		}, LONG_PRESS_MS);
	};

	const breakStatus =
		count > 0
			? t(isToday ? "habit.slipped" : "habit.slippedDay")
			: t(isToday ? "habit.cleanToday" : "habit.cleanDay");

	const secondary = (() => {
		if (trackerDay && dayLine) return dayLine;
		if (isBreak)
			return count > 0 ? <span className="text-danger">{breakStatus}</span> : breakStatus;
		if (log?.skipped) return t("habit.skipped");
		if (state === "rest") return t("habit.rest");
		if (habit.schedule.type === "weekly") {
			const weekLabel = t("habit.weekProgress", { done: week.done, required: week.required });
			return counted && count > 0 ? `${progressLabel(shown, count, t)} · ${weekLabel}` : weekLabel;
		}
		if (counted && (count > 0 || !habit.twoMinute)) return progressLabel(shown, count, t);
		if (count === 0 && habit.twoMinute) return <span className="italic">{habit.twoMinute}</span>;
		return item.identity ? item.identity.statement : null;
	})();

	const ringLabel = isBreak
		? `${name}, ${breakStatus}`
		: counted
			? `${name}, ${progressLabel(shown, count, t)}`
			: name;

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: the name link and ring are the keyboard targets.
		<div
			style={style}
			onClick={() => {
				if (longPressed.current) {
					longPressed.current = false;
					return;
				}
				void navigate({ to: "/habits/$habitId", params: { habitId: habit.id } });
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				setMenuOpen(true);
			}}
			onPointerDown={onPointerDown}
			onPointerUp={clearPress}
			onPointerLeave={clearPress}
			onPointerCancel={clearPress}
			className={cn(
				"group relative flex cursor-pointer select-none items-center gap-3 px-4 py-3 transition-colors duration-(--atomic-duration-fast) [-webkit-touch-callout:none] hover:bg-hover/70 sm:gap-3.5 md:px-5",
				dimmed && "opacity-60",
			)}
		>
			<div className="relative">
				<HabitRingButton
					habit={habit}
					progress={progress}
					state={state}
					extra={item.extra}
					label={ringLabel}
					checkbox={!counted && !isBreak && !trackerActive}
					checked={item.done}
					aria-haspopup={trackerActive ? "dialog" : undefined}
					shake={shake}
					onClick={onRingClick}
					onPointerDown={(event) => event.stopPropagation()}
				/>
				{showExtra ? (
					// "+1" once the target is met (D11). A plus in an outlined disc, so it never reads
					// like the ring's filled "+N" count of reps already logged above the target.
					<Tip label={t("month.extraRep")} side="bottom">
						<button
							type="button"
							aria-label={t("month.extraRep")}
							aria-describedby={nameId}
							onClick={(event) => {
								event.stopPropagation();
								extraRep(habit, day);
							}}
							onPointerDown={(event) => event.stopPropagation()}
							className={cn(
								"-right-2 -bottom-1.5 absolute z-10 grid size-5 place-items-center rounded-full border border-line-strong bg-surface text-ink shadow-card outline-offset-2 transition-[opacity,border-color,background-color,transform] duration-(--atomic-duration-fast) hover:border-(--habit) hover:bg-(--habit-softer) active:scale-90",
								// A larger hit area that grows away from the ring, so the ring's centre stays the ring's.
								"before:-top-1 before:-right-1.5 before:-bottom-1.5 before:absolute before:left-0 before:content-['']",
								// Always visible on touch; with a mouse, on row hover or keyboard focus (and only
								// then does it take clicks).
								"pointer-coarse:size-6",
								"pointer-fine:pointer-events-none pointer-fine:opacity-0 pointer-fine:focus-visible:opacity-100 pointer-fine:group-focus-within:pointer-events-auto pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:pointer-events-auto pointer-fine:group-hover:opacity-100",
							)}
						>
							<Plus aria-hidden="true" className="pointer-coarse:size-3.5 size-3" strokeWidth={3} />
						</button>
					</Tip>
				) : null}
				<AnimatePresence>
					{floats.map((id) => (
						<motion.span
							key={id}
							aria-hidden="true"
							className="-top-1 -translate-x-1/2 pointer-events-none absolute left-1/2 z-10 whitespace-nowrap rounded-full bg-(--habit) px-1.5 py-0.5 font-semibold text-(--habit-on-text) text-[10px] leading-none"
							initial={{ opacity: 0, y: 4 }}
							animate={{ opacity: [0, 1, 1, 0], y: -22 }}
							transition={{ duration: 0.85, ease: "easeOut" }}
						>
							{at("habit.vote", { count: 1 })}
						</motion.span>
					))}
				</AnimatePresence>
			</div>

			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<Link
						id={nameId}
						to="/habits/$habitId"
						params={{ habitId: habit.id }}
						onClick={(event) => {
							event.stopPropagation();
							if (longPressed.current) {
								event.preventDefault();
								longPressed.current = false;
							}
						}}
						className={cn(
							"line-clamp-2 min-w-0 break-words rounded-xs font-medium text-ink leading-snug outline-offset-2",
							item.done && !isBreak && "text-ink-muted",
						)}
					>
						{name}
					</Link>
					{log?.note ? (
						<StickyNote
							aria-label={t("detail.notes")}
							className="size-3.5 shrink-0 text-ink-subtle"
						/>
					) : null}
				</div>
				{secondary || pace ? (
					// Narrow phones leave little room beside the streak chip: give the two-minute
					// version three lines before it is clamped.
					<p
						className={cn(
							"mt-0.5 break-words text-ink-muted text-small sm:line-clamp-2",
							pace ? "line-clamp-4" : "line-clamp-3",
						)}
					>
						{secondary}
						{secondary && pace ? (
							// Phones put the pace on its own line; wider rows keep it inline.
							<>
								<br className="sm:hidden" />
								<span aria-hidden="true" className="hidden sm:inline">
									{" · "}
								</span>
							</>
						) : null}
						{pace ? <span className="font-medium text-ink">{pace}</span> : null}
					</p>
				) : null}
			</div>

			{counted && count > 0 && !trackerDay ? (
				<IconButton
					label={at("habit.decrementFor", { habit: name })}
					size="sm"
					className="hidden opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 md:inline-flex"
					onClick={(event) => {
						event.stopPropagation();
						actions.increment(habit.id, day, -1);
					}}
				>
					<Minus />
				</IconButton>
			) : null}

			<StreakChip habit={habit} streak={streak} compact className="sm:hidden" />
			<StreakChip habit={habit} streak={streak} className="hidden sm:inline-flex" />

			{/* biome-ignore lint/a11y/useKeyWithClickEvents: only stops the row's click-to-open; keys must reach global shortcuts. */}
			<div onClick={(event) => event.stopPropagation()}>
				<HabitActionsMenu
					habit={habit}
					day={day}
					open={menuOpen}
					onOpenChange={setMenuOpen}
					triggerClassName="-mr-1.5 text-ink-subtle md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
				/>
			</div>
		</div>
	);
}
