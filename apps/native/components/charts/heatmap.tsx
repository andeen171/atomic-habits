import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { fonts, useTheme } from "@/lib/theme";
import { type DayKey, type Weekday, addDays, orderedWeekdays, startOfWeek } from "@atomic/core";
import { useAtomic } from "@atomic/core/react";
import { useId, useMemo, useRef, useState } from "react";
import {
	type GestureResponderEvent,
	type LayoutChangeEvent,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop, Text as SvgText } from "react-native-svg";

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
	/** Background behind the grid, for the scrolling edge fades (default: the card surface). */
	fadeColor?: string;
}

const LEFT = 18;
const TOP = 16;
/** Width of the fade on a scrolling grid's clipped edge. */
const EDGE_FADE = 28;

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

/**
 * GitHub-style grid: columns are weeks, rows are weekdays; press shows the day.
 * With a fixed `cellSize` the weeks scroll sideways (newest in view) while the
 * weekday labels stay put, and an edge with weeks out of view fades out, so a
 * column or month label cut by the edge reads as "scroll for more".
 */
export function Heatmap({
	end,
	weeks,
	colorFor,
	describe,
	cellSize,
	accessibilityLabel,
	legend,
	fadeColor,
}: HeatmapProps) {
	const t = useT();
	const { colors } = useTheme();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn) as Weekday;
	const [width, setWidth] = useState(0);
	const [selected, setSelected] = useState<DayKey | null>(null);
	const scroll = useRef<ScrollView>(null);
	const scrolling = Boolean(cellSize);
	/** Left offset of the weeks inside the grid (the labels sit outside a scrolling grid). */
	const left = scrolling ? 0 : LEFT;
	const [edges, setEdges] = useState({ before: false, after: false });
	const viewport = useRef(0);
	const content = useRef(0);
	const fadeId = `heatFade${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
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

	const svgWidth = left + weeks * (cell + gap);
	const svgHeight = TOP + 7 * (cell + gap);
	const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
	const weekdays = orderedWeekdays(weekStartsOn);

	const updateEdges = (offset: number) => {
		const before = offset > 1;
		const after = offset + viewport.current < content.current - 1;
		setEdges((prev) => (prev.before === before && prev.after === after ? prev : { before, after }));
	};
	const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
		viewport.current = layoutMeasurement.width;
		content.current = contentSize.width;
		updateEdges(contentOffset.x);
	};
	// The grid opens on the newest weeks: everything hidden is before the viewport.
	const showNewest = () => {
		scroll.current?.scrollToEnd({ animated: false });
		updateEdges(Math.max(0, content.current - viewport.current));
	};

	// One responder for the whole grid (SVG shapes can't take presses on web).
	const onPress = (event: GestureResponderEvent) => {
		const { locationX, locationY } = pressPoint(event);
		const w = Math.floor((locationX - left) / (cell + gap));
		const d = Math.floor((locationY - TOP) / (cell + gap));
		const day = columns[w]?.[d];
		if (!day || day > end || locationX < left || locationY < TOP) return;
		setSelected((current) => (current === day ? null : day));
	};

	const weekdayLabels = [1, 3, 5].map((row) => (
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
	));
	// Each fade carries its own gradient (an Svg can't reference another's defs on device).
	const fadeTo = fadeColor ?? colors.surface;
	const fade = (side: "before" | "after") => {
		const id = `${fadeId}${side}`;
		const solidFirst = side === "before";
		return (
			<Svg
				width={EDGE_FADE}
				height={svgHeight}
				pointerEvents="none"
				aria-hidden
				style={[styles.fade, solidFirst ? { left: 0 } : { right: 0 }]}
			>
				<Defs>
					<LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
						<Stop offset="0" stopColor={fadeTo} stopOpacity={solidFirst ? 1 : 0} />
						<Stop offset="1" stopColor={fadeTo} stopOpacity={solidFirst ? 0 : 1} />
					</LinearGradient>
				</Defs>
				<Rect x={0} y={0} width={EDGE_FADE} height={svgHeight} fill={`url(#${id})`} />
			</Svg>
		);
	};

	const grid =
		cell > 0 ? (
			<Pressable onPress={onPress} style={{ width: svgWidth, height: svgHeight }}>
				<Svg width={svgWidth} height={svgHeight} pointerEvents="none">
					{months.map((m) => (
						<SvgText
							key={`${m.x}-${m.label}`}
							x={left + m.x * (cell + gap)}
							y={10}
							fontSize={10}
							fontFamily={fonts.medium}
							fill={colors.textSubtle}
						>
							{m.label}
						</SvgText>
					))}
					{scrolling ? null : weekdayLabels}
					{columns.map((col, w) =>
						col.map((day, d) =>
							day > end ? null : (
								<Rect
									key={day}
									x={left + w * (cell + gap)}
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
							x={left + selectedAt.w * (cell + gap) - ringInset}
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
			{scrolling ? (
				<View style={styles.row}>
					{cell > 0 ? (
						<Svg width={LEFT} height={svgHeight} pointerEvents="none">
							{weekdayLabels}
						</Svg>
					) : null}
					<View style={styles.flex}>
						<ScrollView
							ref={scroll}
							horizontal
							showsHorizontalScrollIndicator={false}
							scrollEventThrottle={32}
							onScroll={onScroll}
							onLayout={(event) => {
								viewport.current = event.nativeEvent.layout.width;
								showNewest();
							}}
							onContentSizeChange={(w) => {
								content.current = w;
								showNewest();
							}}
						>
							{grid}
						</ScrollView>
						{cell > 0 && edges.before ? fade("before") : null}
						{cell > 0 && edges.after ? fade("after") : null}
					</View>
				</View>
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

const styles = StyleSheet.create({
	row: { flexDirection: "row" },
	flex: { flex: 1 },
	fade: { position: "absolute", top: 0 },
});
