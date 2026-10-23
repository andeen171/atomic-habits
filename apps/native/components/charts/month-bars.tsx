import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { fonts, makeStyles, useTheme } from "@/lib/theme";
import {
	type Habit,
	MONTH_DAY_CAP,
	type MonthGoal,
	type MonthPeriod,
	monthLabel,
	monthProgressLabel,
	parseDayKey,
	progressLabel,
} from "@atomic/core";
import { useToday } from "@atomic/core/react";
import { useRef, useState } from "react";
import {
	type GestureResponderEvent,
	type LayoutChangeEvent,
	Pressable,
	type StyleProp,
	View,
	type ViewStyle,
} from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";

export interface MonthBarsProps {
	/** The habit for copy (pass the display habit: names and units in the content language). */
	habit: Habit;
	goal: MonthGoal;
	style?: StyleProp<ViewStyle>;
}

const H = 104;
const PAD = { top: 8, right: 2, bottom: 20, left: 2 };

/**
 * The month as bars (Annex H §4/§5, same encoding as web): one bar per day,
 * or per week for weekly habits. A bar rises with the reps logged, clipped
 * at the 2× cap; the part up to the target is the habit's fill, reps above
 * it a lighter fill, and short days a soft fill with an outline. A dashed
 * tick marks each period's target; skipped days get a dashed outline, rest
 * days a dot, missed days a stub, future periods an empty track, and today
 * an accent underline. It is an image for screen readers (the card states
 * the numbers); tapping a bar shows its value above the chart.
 */
export function MonthBars({ habit, goal, style }: MonthBarsProps) {
	const t = useT();
	const today = useToday();
	const { colors, scheme, habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	const [width, setWidth] = useState(0);
	const [active, setActive] = useState<number | null>(null);
	const [tipW, setTipW] = useState(0);
	const periods = goal.periods;
	const n = periods.length;
	const weekly = goal.unit === "weeks";
	const innerW = Math.max(0, width - PAD.left - PAD.right);
	const innerH = H - PAD.top - PAD.bottom;
	const band = n ? innerW / n : 0;
	const barW = Math.max(3, Math.min(weekly ? 36 : 12, band * (weekly ? 0.5 : 0.62)));
	const capOf = (p: MonthPeriod) => Math.max(1, MONTH_DAY_CAP * p.target);
	// Room above the target only as far as the month's extra reps reach (never past the cap),
	// so a month logged exactly on target fills the plot instead of its lower half.
	const yMax = Math.max(
		1,
		...periods.map((p) => Math.max(p.target * 1.25, Math.min(p.count, capOf(p)))),
	);
	const y = (value: number) => PAD.top + (1 - Math.min(value, yMax) / yMax) * innerH;
	const base = y(0);
	const cx = (i: number) => PAD.left + band * i + band / 2;
	const isToday = (p: MonthPeriod) => p.start <= today && today <= p.end;

	const label = t.t("month.chartLabel", {
		month: monthLabel(goal.month, t),
		progress: monthProgressLabel(goal, habit, t),
		status: t.t(`month.status.${goal.status}`),
	});

	// Day numbers every week (1, 8, 15, 22, 29); week starts for weekly habits.
	const tickLabel = (p: MonthPeriod, i: number): string | null => {
		if (weekly) return t.formatDayShort(p.start);
		const day = parseDayKey(p.start).getDate();
		return i === 0 || (day % 7 === 1 && i >= 3) ? String(day) : null;
	};

	const describe = (p: MonthPeriod): string => {
		if (weekly) {
			const span = t.t("month.span", {
				from: t.formatDayShort(p.start),
				to: t.formatDayShort(p.end),
			});
			return `${span} · ${t.t("month.progress", { count: t.number(p.count), goal: t.number(p.owed) })}`;
		}
		const value = p.skipped
			? t.t("habit.skipped")
			: p.owed === 0 && p.count === 0
				? t.t("habit.rest")
				: habit.target > 1 || habit.unit
					? progressLabel(habit, p.count, t)
					: t.tp("common.times", p.count);
		return `${t.formatDayShort(p.start)} · ${value}`;
	};

	const chartRef = useRef<View>(null);
	const select = (x: number) => {
		const i = Math.floor((x - PAD.left) / band);
		if (!Number.isFinite(i) || i < 0 || i >= n) return;
		haptics.selection();
		setActive((current) => (current === i ? null : i));
	};
	// The tapped period, from the touch's window position (the web build has no `locationX`).
	const onPress = (event: GestureResponderEvent) => {
		if (!band) return;
		const { pageX } = event.nativeEvent;
		const node = chartRef.current;
		if (!node || !Number.isFinite(pageX)) return;
		node.measureInWindow((left) => select(pageX - left));
	};

	const activePeriod = active === null ? undefined : periods[active];
	const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
	const subtle = scheme === "dark" ? 0.55 : 0.5;

	return (
		<View style={style}>
			<View
				ref={chartRef}
				onLayout={onLayout}
				style={{ height: H }}
				accessible
				accessibilityRole="image"
				accessibilityLabel={label}
			>
				{width > 0 ? (
					<Pressable
						onPress={onPress}
						testID="month-bars"
						accessible={false}
						importantForAccessibility="no-hide-descendants"
						style={{ width, height: H }}
					>
						<Svg width={width} height={H} pointerEvents="none">
							<Line
								x1={PAD.left}
								x2={width - PAD.right}
								y1={base + 0.5}
								y2={base + 0.5}
								stroke={colors.border}
								strokeWidth={1}
							/>
							{periods.map((p, i) => {
								const x0 = cx(i) - barW / 2;
								const dim = active !== null && active !== i ? 0.45 : 1;
								const targetY = y(p.target);
								const shown = Math.min(p.count, capOf(p));
								const met = p.target > 0 && p.count >= p.target;
								const r = Math.min(3, barW / 2);
								const rest = p.owed === 0 && p.count === 0;
								const label = tickLabel(p, i);
								const now = isToday(p);
								return (
									<G key={p.start} opacity={dim}>
										{p.future && !now ? (
											<Rect
												x={x0}
												y={targetY}
												width={barW}
												height={Math.max(0, base - targetY)}
												rx={r}
												fill={colors.heat0}
											/>
										) : p.skipped ? (
											<Rect
												x={x0 + 0.5}
												y={targetY + 0.5}
												width={Math.max(0, barW - 1)}
												height={Math.max(0, base - targetY - 1)}
												rx={r}
												fill="none"
												stroke={colors.borderStrong}
												strokeDasharray="3 2"
											/>
										) : rest ? (
											<Circle cx={cx(i)} cy={base - 3} r={1.75} fill={colors.borderStrong} />
										) : shown > 0 ? (
											<>
												{/* Up to the target: the habit's fill when met, its soft fill when short. */}
												<Path
													d={roundedTop(
														x0,
														y(Math.min(shown, p.target)),
														barW,
														base,
														shown > p.target ? 0 : r,
													)}
													fill={met ? tone.fill : tone.soft}
													// A short day's soft fill gets an outline, so it reads on light hues too.
													stroke={met ? undefined : tone.fill}
													strokeOpacity={met ? undefined : 0.55}
													strokeWidth={met ? undefined : 1}
												/>
												{/* Reps above the target (credited up to the 2× cap). */}
												{shown > p.target ? (
													<Path
														d={roundedTop(x0, y(shown), barW, targetY, r)}
														fill={tone.fill}
														fillOpacity={0.45}
													/>
												) : null}
											</>
										) : (
											// A missed day: a short stub on the baseline, so the gap reads as a day.
											<Rect
												x={x0}
												y={base - 2}
												width={barW}
												height={2}
												rx={1}
												fill={colors.borderStrong}
											/>
										)}
										{/* The period's target. */}
										{!rest && !p.skipped ? (
											<Line
												x1={x0 - 1.5}
												x2={x0 + barW + 1.5}
												y1={targetY}
												y2={targetY}
												stroke={colors.textSubtle}
												strokeWidth={1}
												strokeDasharray="2 2"
												opacity={met ? subtle : 0.85}
											/>
										) : null}
										{now ? (
											<Rect
												x={x0 - 1}
												y={base + 3}
												width={barW + 2}
												height={2.5}
												rx={1.25}
												fill={colors.accent}
											/>
										) : null}
										{label ? (
											<SvgText
												x={cx(i)}
												y={H - 4}
												dx={i === 0 && !weekly ? -barW / 2 + 0.5 : 0}
												fontSize={10}
												fontFamily={now ? fonts.semibold : fonts.medium}
												fill={now ? colors.text : colors.textSubtle}
												textAnchor={i === 0 && !weekly ? "start" : "middle"}
											>
												{label}
											</SvgText>
										) : null}
									</G>
								);
							})}
						</Svg>
					</Pressable>
				) : null}
			</View>
			{/* The tapped bar's value, over the chart's headroom (no layout shift). */}
			{activePeriod ? (
				<View
					pointerEvents="none"
					onLayout={(event) => setTipW(event.nativeEvent.layout.width)}
					style={[
						styles.tip,
						{
							opacity: tipW ? 1 : 0,
							left: Math.min(Math.max(0, cx(active ?? 0) - tipW / 2), Math.max(0, width - tipW)),
						},
					]}
				>
					<Text variant="tiny" weight="semibold" tabular numberOfLines={1}>
						{describe(activePeriod)}
					</Text>
				</View>
			) : null}
		</View>
	);
}

/** A bar from `top` down to `bottom` whose top corners are rounded by `r`. */
function roundedTop(x: number, top: number, w: number, bottom: number, r: number): string {
	const h = bottom - top;
	if (h <= 0) return "";
	const rr = Math.min(r, h, w / 2);
	return `M${x},${bottom}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${bottom}Z`;
}

const useStyles = makeStyles((t) => ({
	tip: {
		position: "absolute",
		top: -6,
		height: 24,
		paddingHorizontal: 8,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.sunken,
		borderWidth: 1,
		borderColor: t.colors.border,
	},
}));
