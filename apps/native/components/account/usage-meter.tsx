import { ProgressBar } from "@/components/ui/progress-bar";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import { View } from "react-native";

/**
 * One usage meter of the plan section (Annex C §5): a `progressbar` with
 * its range and the same "23 MB of 100 MB" as visible text, so the fill
 * colour (accent, warning from 90 %) never carries the meaning alone.
 * Owner: T5.
 */
export function UsageMeter({
	label,
	used,
	limit,
	format,
	hint,
	testID,
}: {
	label: string;
	used: number;
	limit: number;
	format(value: number): string;
	hint?: string | null;
	testID?: string;
}) {
	const t = useT();
	const styles = useStyles();
	const safeLimit = Math.max(0, limit);
	const ratio = safeLimit > 0 ? Math.min(1, Math.max(0, used / safeLimit)) : 0;
	const text = t.t("plan.usage.of", { used: format(used), limit: format(safeLimit) });
	return (
		<View style={styles.meter} testID={testID}>
			<View style={styles.head}>
				<Text variant="small" weight="medium" style={styles.label}>
					{label}
				</Text>
				<Text variant="small" tone="muted" tabular>
					{text}
				</Text>
			</View>
			<ProgressBar
				value={Math.min(Math.max(0, used), safeLimit)}
				max={safeLimit || 1}
				tone={ratio >= 0.9 ? "warning" : "accent"}
				accessibilityLabel={label}
				valueText={hint ? `${text}. ${hint}` : text}
			/>
			{hint ? (
				<Text variant="small" tone="muted">
					{hint}
				</Text>
			) : null}
		</View>
	);
}

const useStyles = makeStyles(() => ({
	meter: { gap: 7 },
	head: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "baseline",
		justifyContent: "space-between",
		columnGap: 12,
		rowGap: 2,
	},
	label: { flexShrink: 1 },
}));
