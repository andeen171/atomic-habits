import { useT } from "@/lib/messages";
import { useElementWidth } from "@/lib/use-element-width";
import { clamp, cn } from "@/lib/utils";
import {
	type DayKey,
	type Weekday,
	addDays,
	orderedWeekdays,
	parseDayKey,
	startOfWeek,
} from "@atomic/core";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface HeatCell {
	/** 0–4 intensity, or null for days outside the habit's life (rendered faint). */
	level: number | null;
	label: string;
}

interface HeatmapProps {
	end: DayKey;
	weekStartsOn: Weekday;
	maxWeeks: number;
	minWeeks?: number;
	cell(day: DayKey): HeatCell;
	color(level: number): string;
	label: string;
	/** Keep every week and scroll horizontally when space is tight (year view). */
	scrollable?: boolean;
	className?: string;
}

const LABEL_W = 30;
const TOP = 18;
const GAP = 3;
/** Width of the fade on a scrolling grid's clipped edge. */
const EDGE_FADE = 28;

/** GitHub-style grid: columns are weeks, rows weekdays, months on top. */
export function Heatmap({
	end,
	weekStartsOn,
	maxWeeks,
	minWeeks = 12,
	cell,
	color,
	label,
	scrollable,
	className,
}: HeatmapProps) {
	const { t } = useT();
	const [ref, width] = useElementWidth<HTMLDivElement>();
	const scrollRef = useRef<HTMLDivElement>(null);
	const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

	const avail = Math.max(0, width - LABEL_W);
	let weeks: number;
	let size: number;
	if (scrollable) {
		weeks = maxWeeks;
		size = clamp(Math.floor(avail / weeks - GAP), 10, 16);
	} else {
		weeks = clamp(Math.floor(avail / (16 + GAP)), minWeeks, maxWeeks);
		size = clamp(Math.floor(avail / weeks - GAP), 8, 20);
	}
	const step = size + GAP;
	const svgWidth = LABEL_W + weeks * step - GAP;
	const svgHeight = TOP + 7 * step - GAP;

	const grid = useMemo(() => {
		const start = addDays(startOfWeek(end, weekStartsOn), -(weeks - 1) * 7);
		const columns: { day: DayKey; data: HeatCell | null }[][] = [];
		const months: { col: number; text: string }[] = [];
		for (let w = 0; w < weeks; w++) {
			const column: { day: DayKey; data: HeatCell | null }[] = [];
			for (let d = 0; d < 7; d++) {
				const day = addDays(start, w * 7 + d);
				column.push({ day, data: day > end ? null : cell(day) });
			}
			const firstDate = parseDayKey(column[0]?.day ?? start);
			if (firstDate.getDate() <= 7 && w < weeks - 1) {
				months.push({ col: w, text: t.monthName(firstDate.getMonth(), "short") });
			}
			columns.push(column);
		}
		return { columns, months };
	}, [end, weekStartsOn, weeks, cell, t]);

	// Which sides of a scrolling grid hold weeks out of view: those edges fade,
	// so a column (or month label) cut by the edge reads as "scroll for more".
	const [hidden, setHidden] = useState({ before: false, after: false });
	const measureEdges = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const before = el.scrollLeft > 1;
		const after = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
		setHidden((prev) =>
			prev.before === before && prev.after === after ? prev : { before, after },
		);
	}, []);

	// Re-run when the grid width changes so the newest weeks stay in view.
	const scrollKey = scrollable && width > 0 ? svgWidth + width : 0;
	useLayoutEffect(() => {
		if (scrollKey && scrollRef.current)
			scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
		measureEdges();
	}, [scrollKey, measureEdges]);
	const fade =
		scrollable && (hidden.before || hidden.after)
			? `linear-gradient(to right, ${hidden.before ? "transparent" : "#000"}, #000 ${EDGE_FADE}px, #000 calc(100% - ${EDGE_FADE}px), ${hidden.after ? "transparent" : "#000"})`
			: undefined;

	const weekdayRows = orderedWeekdays(weekStartsOn);

	return (
		<div ref={ref} className={cn("relative w-full", className)}>
			{width > 0 ? (
				<div
					ref={scrollRef}
					onScroll={scrollable ? measureEdges : undefined}
					className={cn(scrollable && "scrollbar-none overflow-x-auto")}
					style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
				>
					<svg
						role="img"
						aria-label={label}
						width={svgWidth}
						height={svgHeight}
						className="block"
						onPointerLeave={() => setHover(null)}
					>
						{grid.months.map((m) => (
							<text
								key={`${m.col}-${m.text}`}
								x={LABEL_W + m.col * step}
								y={11}
								className="fill-ink-subtle text-[10px] capitalize"
							>
								{m.text}
							</text>
						))}
						{[0, 2, 4].map((row) => (
							<text
								key={row}
								x={0}
								y={TOP + row * step + size / 2 + 3.5}
								className="fill-ink-subtle text-[10px] capitalize"
							>
								{t.weekdayName(weekdayRows[row] ?? 0, "short")}
							</text>
						))}
						{grid.columns.map((column, w) =>
							column.map(({ day, data }, d) => {
								if (!data) return null;
								const x = LABEL_W + w * step;
								const y = TOP + d * step;
								return (
									<rect
										key={day}
										x={x}
										y={y}
										width={size}
										height={size}
										rx={Math.min(4, size / 3.5)}
										fill={data.level === null ? "var(--heat-0)" : color(data.level)}
										opacity={data.level === null ? 0.45 : 1}
										className={cn(day === end && "stroke-accent")}
										strokeWidth={day === end ? 1.5 : 0}
										onPointerEnter={() => setHover({ x: x + size / 2, y, text: data.label })}
									/>
								);
							}),
						)}
					</svg>
				</div>
			) : (
				<div style={{ height: TOP + 7 * 17 }} />
			)}
			{hover && svgWidth <= width + 1 ? (
				<div
					className="-translate-x-1/2 -translate-y-full pointer-events-none absolute z-10 whitespace-nowrap rounded-sm bg-ink px-2 py-1 font-medium text-bg text-tiny shadow-pop"
					style={{ left: hover.x, top: hover.y - 6 }}
				>
					{hover.text}
				</div>
			) : null}
		</div>
	);
}

export function HeatLegend({
	color,
	className,
}: { color(level: number): string; className?: string }) {
	const { t } = useT();
	return (
		<div className={cn("flex items-center gap-1.5 text-ink-subtle text-tiny", className)}>
			<span>{t("detail.less")}</span>
			{[0, 1, 2, 3, 4].map((level) => (
				<span key={level} className="size-2.5 rounded-[3px]" style={{ background: color(level) }} />
			))}
			<span>{t("detail.more")}</span>
		</div>
	);
}
