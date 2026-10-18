import type { DayKey, MessageKey } from "@atomic/core";
import { principleOfTheDay } from "@atomic/core";
import { Quote } from "lucide-react-native";
import { View } from "react-native";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";

/** "Principle of the day" — a quiet reminder of the philosophy. */
export function PrincipleCard({ day }: { day: DayKey }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const principle = principleOfTheDay(day, t.locale);
	const law =
		principle.law >= 1 && principle.law <= 4
			? t.t(`law.${principle.law}.name` as MessageKey)
			: principle.law === 5
				? t.t("habits.filter.break")
				: null;
	return (
		<Card padding={20} style={styles.card}>
			<View style={styles.top}>
				<Text variant="label">{t.t("today.principle")}</Text>
				{law ? (
					<View style={styles.badge}>
						<Text variant="tiny" weight="semibold" tone="muted">
							{law}
						</Text>
					</View>
				) : null}
			</View>
			<View style={styles.titleRow}>
				<Quote size={18} color={colors.accent} strokeWidth={2} style={{ marginTop: 6 }} />
				<Text variant="display" style={{ flex: 1 }}>
					{principle.title}
				</Text>
			</View>
			<Text tone="muted">{principle.body}</Text>
		</Card>
	);
}

const useStyles = makeStyles((t) => ({
	card: { gap: 10 },
	top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
	badge: {
		paddingHorizontal: 8,
		paddingVertical: 3,
		borderRadius: 999,
		backgroundColor: t.colors.sunken,
	},
	titleRow: { flexDirection: "row", gap: 10 },
}));
