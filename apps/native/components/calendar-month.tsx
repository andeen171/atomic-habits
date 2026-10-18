import { ChevronLeft, ChevronRight } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type DayKey,
	type Weekday,
	addMonths,
	capitalize,
	isSameMonth,
	monthGrid,
	orderedWeekdays,
	startOfMonth,
} from "@atomic/core";
import { useAtomic } from "@atomic/core/react";
import type { ReactNode } from "react";
import { View } from "react-native";

export interface CalendarMonthProps {
	month: DayKey;
	onMonthChange: (month: DayKey) => void;
	/** Render a day cell; `inMonth` is false for padding days. */
	renderDay: (day: DayKey, inMonth: boolean) => ReactNode;
	/** Disable the "next" arrow past this month. */
	maxMonth?: DayKey;
}

/** Month grid (`monthGrid`) with a header and weekday labels. */
export function CalendarMonth({ month, onMonthChange, renderDay, maxMonth }: CalendarMonthProps) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn) as Weekday;
	const rows = monthGrid(month, weekStartsOn);
	const canNext = !maxMonth || startOfMonth(month) < startOfMonth(maxMonth);
	return (
		<View>
			<View style={styles.header}>
				<Text variant="h3">{capitalize(t.formatMonth(month))}</Text>
				<View style={styles.arrows}>
					<IconButton
						icon={ChevronLeft}
						size={34}
						iconSize={18}
						variant="soft"
						color={colors.textMuted}
						accessibilityLabel={t.x("a11y.prevMonth")}
						onPress={() => onMonthChange(addMonths(startOfMonth(month), -1))}
					/>
					<IconButton
						icon={ChevronRight}
						size={34}
						iconSize={18}
						variant="soft"
						color={colors.textMuted}
						disabled={!canNext}
						accessibilityLabel={t.x("a11y.nextMonth")}
						onPress={() => onMonthChange(addMonths(startOfMonth(month), 1))}
					/>
				</View>
			</View>
			<View style={styles.week}>
				{orderedWeekdays(weekStartsOn).map((d) => (
					<Text
						key={d}
						variant="tiny"
						weight="semibold"
						tone="subtle"
						align="center"
						style={styles.cell}
					>
						{t.weekdayName(d, "min")}
					</Text>
				))}
			</View>
			{rows.map((row) => (
				<View key={row[0]} style={styles.week}>
					{row.map((day) => (
						<View key={day} style={styles.cell}>
							{renderDay(day, isSameMonth(day, month))}
						</View>
					))}
				</View>
			))}
		</View>
	);
}

const useStyles = makeStyles(() => ({
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginBottom: 12,
	},
	arrows: { flexDirection: "row", gap: 8 },
	week: { flexDirection: "row", marginBottom: 4 },
	cell: { flex: 1, alignItems: "center" },
}));
