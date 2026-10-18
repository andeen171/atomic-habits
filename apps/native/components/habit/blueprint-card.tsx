import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { type Habit, type Identity, type MessageKey, blueprintLines } from "@atomic/core";
import { View } from "react-native";

/** The four laws applied to a habit, each with its law badge. */
export function BlueprintCard({
	habit,
	identity,
	showHint = true,
}: {
	habit: Habit;
	identity?: Identity;
	showHint?: boolean;
}) {
	const t = useT();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	const lines = blueprintLines(habit, t);
	const isBreak = habit.kind === "break";
	const laws = [1, 2, 3, 4] as const;
	return (
		<Card padding={18} style={styles.card}>
			{showHint ? (
				<Text variant="small" tone="muted">
					{t.t("detail.blueprintHint")}
				</Text>
			) : null}
			{lines.length === 0 ? (
				<Text variant="small" tone="subtle" italic>
					{t.t("detail.blueprintEmpty")}
				</Text>
			) : (
				laws.map((law) => {
					const forLaw = lines.filter((l) => l.law === law);
					if (!forLaw.length) return null;
					return (
						<View key={law} style={styles.law}>
							<View style={[styles.badge, { backgroundColor: tone.soft }]}>
								<Text variant="small" weight="bold" color={tone.text} tabular>
									{law}
								</Text>
							</View>
							<View style={{ flex: 1, gap: 3 }}>
								<Text variant="label">
									{t.t(`law.${law}.${isBreak ? "inverse" : "name"}` as MessageKey)}
								</Text>
								{forLaw.map((line) => (
									<Text key={line.text}>{line.text}</Text>
								))}
							</View>
						</View>
					);
				})
			)}
			{identity ? (
				<View style={styles.identity}>
					<Text variant="label">{t.t("detail.identity")}</Text>
					<Text variant="h3" color={tone.text}>
						{`${identity.emoji} ${identity.statement}`}
					</Text>
				</View>
			) : null}
		</Card>
	);
}

const useStyles = makeStyles((t) => ({
	card: { gap: 16 },
	law: { flexDirection: "row", gap: 12 },
	badge: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
	identity: {
		gap: 4,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
		paddingTop: 14,
	},
}));
