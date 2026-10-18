import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { useHabitLogger } from "@/lib/use-habit-logger";
import { cn } from "@/lib/utils";
import { type AgendaItem, type DayKey, progressLabel } from "@atomic/core";
import { useActions, useToday } from "@atomic/core/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Minus, StickyNote } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type MouseEvent, type PointerEvent, useRef, useState } from "react";
import { IconButton } from "../ui/icon-button";
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
	const actions = useActions();
	const navigate = useNavigate();
	const today = useToday();
	const { tap } = useHabitLogger();
	const style = useHabitStyle(habit.color);
	const [menuOpen, setMenuOpen] = useState(false);
	const [shake, setShake] = useState(false);
	const [floats, setFloats] = useState<number[]>([]);
	const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** Set when a long-press opened the menu, so the trailing click doesn't navigate. */
	const longPressed = useRef(false);
	const isBreak = habit.kind === "break";
	const counted = !isBreak && habit.target > 1;

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

	const isToday = day === today;
	const breakStatus =
		count > 0
			? t(isToday ? "habit.slipped" : "habit.slippedDay")
			: t(isToday ? "habit.cleanToday" : "habit.cleanDay");

	const secondary = (() => {
		if (isBreak)
			return count > 0 ? <span className="text-danger">{breakStatus}</span> : breakStatus;
		if (log?.skipped) return t("habit.skipped");
		if (state === "rest") return t("habit.rest");
		if (habit.schedule.type === "weekly") {
			const weekLabel = t("habit.weekProgress", { done: week.done, required: week.required });
			return counted && count > 0 ? `${progressLabel(habit, count, t)} · ${weekLabel}` : weekLabel;
		}
		if (counted && (count > 0 || !habit.twoMinute)) return progressLabel(habit, count, t);
		if (count === 0 && habit.twoMinute) return <span className="italic">{habit.twoMinute}</span>;
		return item.identity ? item.identity.statement : null;
	})();

	const ringLabel = isBreak
		? `${habit.name}, ${breakStatus}`
		: counted
			? `${habit.name}, ${progressLabel(habit, count, t)}`
			: habit.name;

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
					label={ringLabel}
					checkbox={!counted && !isBreak}
					checked={item.done}
					shake={shake}
					onClick={onRingClick}
					onPointerDown={(event) => event.stopPropagation()}
				/>
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
						{habit.name}
					</Link>
					{log?.note ? (
						<StickyNote
							aria-label={t("detail.notes")}
							className="size-3.5 shrink-0 text-ink-subtle"
						/>
					) : null}
				</div>
				{secondary ? (
					// Narrow phones leave little room beside the streak chip: give the two-minute
					// version three lines before it is clamped.
					<p className="mt-0.5 line-clamp-3 break-words text-ink-muted text-small sm:line-clamp-2">
						{secondary}
					</p>
				) : null}
			</div>

			{counted && count > 0 ? (
				<IconButton
					label={at("habit.decrementFor", { habit: habit.name })}
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
