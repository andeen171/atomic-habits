import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { fonts, useTheme } from "@/lib/theme";
import { type DayKey, type Weekday, addDays, orderedWeekdays, startOfWeek } from "@atomic/core";
import { useAtomic } from "@atomic/core/react";
import { useMemo, useRef, useState } from "react";
import {
	type GestureResponderEvent,
	type LayoutChangeEvent,
	Pressable,
	ScrollView,
	View,
} from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

export interface HeatmapProps {
	/** Last day shown (usually today). */
	end: DayKey;
	weeks: number;
	colorFor: (day: DayKey) => string;
	/** Tooltip text for a pressed day ("Oct 12 · 3/10 pages"). */
	describe: (day: DayKey) => string;
	/** Fixed cell size with horizontal scrolling (year view). */
	cellSize?: number;
	accessibilityLabel: string;
	legend?: string[];
}

const LEFT = 18;
const TOP = 16;

/** Press position in the grid; react-native-web hands over a DOM MouseEvent (offsetX/Y) instead. */
function pressPoint(event: GestureResponderEvent) {
	const native = event.nativeEvent as Partial<{
		locationX: number;
		locationY: number;
		offsetX: number;
		offsetY: number;
	}>;
	return {
		locationX: native.locationX ?? native.offsetX ?? -1,
		locationY: native.locationY ?? native.offsetY ?? -1,
	};
}

/** GitHub-style grid: columns are weeks, rows are weekdays; press shows the day. */
export function Heatmap({
	end,
	weeks,
	colorFor,
	describe,
	cellSize,
	accessibilityLabel,
	legend,
}: HeatmapProps) {
	const t = useT();
	const { colors } = useTheme();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn) as Weekday;
	const [width, setWidth] = useState(0);
	const [selected, setSelected] = useState<DayKey | null>(null);
	const scroll = useRef<ScrollView>(null);
	const gap = 3;
	const cell = cellSize ?? (width ? Math.floor((width - LEFT - gap * (weeks - 1)) / weeks) : 0);
	const first = addDays(startOfWeek(end, weekStartsOn), -(weeks - 1) * 7);

	const columns = useMemo(
		() =>
			Array.from({ length: weeks }, (_, w) =>
				Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)),
			),
		[first, weeks],
	);
	const months = useMemo(() => {
		const out: { x: number; label: string }[] = [];
		let last = "";
		columns.forEach((col, w) => {
			const day = col[0] ?? first;
			const month = day.slice(0, 7);
			if (month !== last) {
				last = month;
				if (w < weeks - 1)
					out.push({ x: w, label: t.monthName(Number(day.slice(5, 7)) - 1, "short") });
			}
		});
		// Drop a label that would collide with the next one.
		return out.filter((m, i) => !out[i + 1] || (out[i + 1]?.x ?? 0) - m.x >= 3);
	}, [columns, first, weeks, t]);

	const radius = Math.max(2, cell * 0.22);
	const ringWidth = 1.5;
	const ringInset = gap / 2;
	const selectedAt = useMemo(() => {
		if (!selected) return null;
		for (let w = 0; w < columns.length; w++) {
			const d = columns[w]?.indexOf(selected) ?? -1;
			if (d >= 0) return { w, d };
		}
		return null;
	}, [columns, selected]);

	const svgWidth = LEFT + weeks * (cell + gap);
	const svgHeight = TOP + 7 * (cell + gap);
	const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
	const weekdays = orderedWeekdays(weekStartsOn);

	// One responder for the whole grid (SVG shapes can't take presses on web).
	const onPress = (event: GestureResponderEvent) => {
		const { locationX, locationY } = pressPoint(event);
		const w = Math.floor((locationX - LEFT) / (cell + gap));
		const d = Math.floor((locationY - TOP) / (cell + gap));
		const day = columns[w]?.[d];
		if (!day || day > end || locationX < LEFT || locationY < TOP) return;
		setSelected((current) => (current === day ? null : day));
	};

	const grid =
		cell > 0 ? (
			<Pressable onPress={onPress} style={{ width: svgWidth, height: svgHeight }}>
				<Svg width={svgWidth} height={svgHeight} pointerEvents="none">
					{months.map((m) => (
						<SvgText
							key={`${m.x}-${m.label}`}
							x={LEFT + m.x * (cell + gap)}
							y={10}
							fontSize={10}
							fontFamily={fonts.medium}
							fill={colors.textSubtle}
						>
							{m.label}
						</SvgText>
					))}
					{[1, 3, 5].map((row) => (
						<SvgText
							key={row}
							x={0}
							y={TOP + row * (cell + gap) + cell * 0.75}
							fontSize={9}
							fontFamily={fonts.medium}
							fill={colors.textSubtle}
						>
							{t.weekdayName(weekdays[row] ?? 0, "min")}
						</SvgText>
					))}
					{columns.map((col, w) =>
						col.map((day, d) =>
							day > end ? null : (
								<Rect
									key={day}
									x={LEFT + w * (cell + gap)}
									y={TOP + d * (cell + gap)}
									width={cell}
									height={cell}
									rx={radius}
									fill={colorFor(day)}
								/>
							),
						),
					)}
					{selectedAt ? (
						// Ring sits in the gap around the cell, so it never draws on the habit fill.
						<Rect
							x={LEFT + selectedAt.w * (cell + gap) - ringInset}
							y={TOP + selectedAt.d * (cell + gap) - ringInset}
							width={cell + ringInset * 2}
							height={cell + ringInset * 2}
							rx={radius + ringInset}
							fill="none"
							stroke={colors.text}
							strokeWidth={ringWidth}
						/>
					) : null}
				</Svg>
			</Pressable>
		) : null;

	return (
		<View
			onLayout={onLayout}
			accessible
			accessibilityRole="image"
			accessibilityLabel={accessibilityLabel}
		>
			{cellSize ? (
				<ScrollView
					ref={scroll}
					horizontal
					showsHorizontalScrollIndicator={false}
					onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
				>
					{grid}
				</ScrollView>
			) : (
				grid
			)}
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					marginTop: 8,
					minHeight: 18,
				}}
			>
				<Text
					variant="tiny"
					weight="medium"
					tone={selected ? "default" : "subtle"}
					numberOfLines={1}
					style={{ flex: 1 }}
				>
					{selected ? describe(selected) : ""}
				</Text>
				{legend ? (
					<View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
						<Text variant="tiny" tone="subtle" style={{ marginRight: 3 }}>
							{t.t("detail.less")}
						</Text>
						{legend.map((color) => (
							<View
								key={color}
								style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }}
							/>
						))}
						<Text variant="tiny" tone="subtle" style={{ marginLeft: 3 }}>
							{t.t("detail.more")}
						</Text>
					</View>
				) : null}
			</View>
		</View>
	);
}
