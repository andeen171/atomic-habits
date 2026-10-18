import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	type DayKey,
	addDays,
	dayScore,
	parseDayKey,
	startOfWeek,
	weekDays,
	weekdayOf,
} from "@atomic/core";
import { useAtomic, useHabits, useLogIndex, useToday } from "@atomic/core/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../ui/icon-button";

interface WeekStripProps {
	selected: DayKey;
	onSelect(day: DayKey): void;
}

const SIZE = 36;
const STROKE = 3;

/** Seven mini rings for the week (respects week start); past days are editable. */
export function WeekStrip({ selected, onSelect }: WeekStripProps) {
	const { t, at } = useT();
	const today = useToday();
	const habits = useHabits();
	const index = useLogIndex();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const [anchor, setAnchor] = useState(() => startOfWeek(selected, weekStartsOn));

	useEffect(() => {
		setAnchor(startOfWeek(selected, weekStartsOn));
	}, [selected, weekStartsOn]);

	const days = useMemo(() => weekDays(anchor, weekStartsOn), [anchor, weekStartsOn]);
	const scores = useMemo(
		() => days.map((day) => (day > today ? null : dayScore(habits, index, day, weekStartsOn))),
		[days, habits, index, today, weekStartsOn],
	);
	const canGoNext = addDays(anchor, 7) <= today;
	const swipeStart = useRef<number | null>(null);
	const onPointerDown = (event: PointerEvent) => {
		if (event.pointerType === "touch") swipeStart.current = event.clientX;
	};
	const onPointerUp = (event: PointerEvent) => {
		if (swipeStart.current === null) return;
		const dx = event.clientX - swipeStart.current;
		swipeStart.current = null;
		if (dx > 48) setAnchor(addDays(anchor, -7));
		else if (dx < -48 && canGoNext) setAnchor(addDays(anchor, 7));
	};
	const first = days[0] ?? anchor;
	const last = days[6] ?? anchor;
	const monthLabel =
		parseDayKey(first).getMonth() === parseDayKey(last).getMonth()
			? t.formatMonth(first)
			: `${t.monthName(parseDayKey(first).getMonth(), "short")} – ${t.formatMonth(last)}`;

	const r = SIZE / 2 - STROKE / 2;
	const c = 2 * Math.PI * r;

	return (
		<section
			aria-label={t("today.weekStrip")}
			className="rounded-xl border border-line bg-surface p-3 shadow-card md:p-4"
		>
			<div className="mb-2 flex items-center justify-between gap-2 pl-1">
				<h2 className="font-medium text-ink-muted text-small first-letter:uppercase">
					{monthLabel}
				</h2>
				<div className="flex items-center">
					<IconButton
						label={at("week.previous")}
						size="sm"
						onClick={() => setAnchor(addDays(anchor, -7))}
					>
						<ChevronLeft />
					</IconButton>
					<IconButton
						label={at("week.next")}
						size="sm"
						disabled={!canGoNext}
						onClick={() => setAnchor(addDays(anchor, 7))}
					>
						<ChevronRight />
					</IconButton>
				</div>
			</div>
			<ol
				className="grid touch-pan-y grid-cols-7 gap-1"
				onPointerDown={onPointerDown}
				onPointerUp={onPointerUp}
				onPointerCancel={() => {
					swipeStart.current = null;
				}}
			>
				{days.map((day, i) => {
					const score = scores[i];
					const isToday = day === today;
					const isSelected = day === selected;
					const future = day > today;
					const ratio = score?.ratio ?? 0;
					const due = score?.due ?? 0;
					const perfect = !!score && score.due > 0 && score.done === score.due;
					const date = parseDayKey(day).getDate();
					const label = `${t.formatDayLong(day)}${score && due ? ` — ${t("today.progress", { done: score.done, total: due })}` : ""}`;
					return (
						<li key={day} className="flex justify-center">
							<button
								type="button"
								disabled={future}
								aria-label={label}
								aria-current={isSelected ? "date" : undefined}
								onClick={() => onSelect(day)}
								className={cn(
									"relative flex w-full max-w-16 flex-col items-center gap-1.5 rounded-lg py-2 transition-colors duration-(--atomic-duration-fast)",
									!future && "hover:bg-hover",
									future && "opacity-40",
								)}
							>
								{isSelected ? (
									<motion.span
										layoutId="week-strip-selection"
										className="forced-selected absolute inset-0 rounded-lg bg-sunken"
										transition={{ type: "spring", stiffness: 500, damping: 40 }}
									/>
								) : null}
								<span
									className={cn(
										"relative font-semibold text-[11px] uppercase leading-none tracking-wide",
										isToday ? "text-accent-text" : "text-ink-subtle",
									)}
								>
									{t.weekdayName(weekdayOf(day), "min")}
								</span>
								<span
									className="relative grid place-items-center"
									style={{ width: SIZE, height: SIZE }}
								>
									<svg
										width={SIZE}
										height={SIZE}
										aria-hidden="true"
										className="-rotate-90 absolute inset-0"
									>
										<circle
											cx={SIZE / 2}
											cy={SIZE / 2}
											r={r}
											fill={perfect ? "var(--accent)" : "none"}
											stroke={due ? "var(--heat-0)" : "transparent"}
											strokeWidth={STROKE}
										/>
										{due && !perfect ? (
											<circle
												cx={SIZE / 2}
												cy={SIZE / 2}
												r={r}
												fill="none"
												stroke="var(--accent)"
												strokeWidth={STROKE}
												strokeLinecap="round"
												strokeDasharray={c}
												strokeDashoffset={c * (1 - ratio)}
												className="transition-[stroke-dashoffset] duration-(--atomic-duration-slow) ease-out-soft"
											/>
										) : null}
									</svg>
									<span
										className={cn(
											"relative text-small tabular-nums",
											perfect
												? "font-semibold text-on-accent"
												: isToday
													? "font-semibold text-accent-text"
													: "text-ink",
										)}
									>
										{date}
									</span>
								</span>
							</button>
						</li>
					);
				})}
			</ol>
		</section>
	);
}
