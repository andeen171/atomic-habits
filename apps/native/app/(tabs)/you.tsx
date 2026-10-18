import {
	ChartColumn,
	ClipboardList,
	Cloud,
	CloudAlert,
	Fingerprint,
	Flame,
	Settings,
} from "@/components/icons";
import { Card } from "@/components/ui/card";
import { ListGroup, ListRow, ListSeparator } from "@/components/ui/list-row";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	useAllHabitStats,
	useAllHabits,
	useAtomic,
	useIdentityStats,
	useSyncState,
} from "@atomic/core/react";
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

export default function YouScreen() {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const name = useAtomic((s) => s.settings.displayName.trim());
	const habits = useAllHabits();
	const stats = useAllHabitStats(habits);
	const identities = useIdentityStats();
	const sync = useSyncState(syncController);

	const totals = useMemo(() => {
		let votes = 0;
		let best = 0;
		for (const habit of habits) {
			const s = stats.get(habit.id);
			if (!s) continue;
			votes += s.votes;
			if (habit.kind === "build" && s.streak.unit === "days")
				best = Math.max(best, s.streak.current);
		}
		return { votes, best, active: habits.filter((h) => !h.archivedAt).length };
	}, [habits, stats]);

	return (
		<Screen tab testID="you-screen">
			<ScreenTitle
				eyebrow={name ? t.x("you.greeting", { name }) : undefined}
				title={t.t("nav.you")}
				subtitle={t.x("you.subtitle")}
			/>

			<Card padding={20} style={styles.hero}>
				<View style={styles.heroMain}>
					<Text variant="label">{t.t("insights.totalVotes")}</Text>
					<Text variant="hero" tabular accessibilityLabel={t.tp("common.votes", totals.votes)}>
						{t.number(totals.votes)}
					</Text>
				</View>
				<View style={styles.heroStats}>
					<View style={styles.heroStat}>
						<View style={styles.inline}>
							<Flame size={15} color={colors.accent} fill={colors.accent} />
							<Text variant="h2" tabular>
								{t.number(totals.best)}
							</Text>
						</View>
						<Text variant="tiny" tone="muted">
							{t.t("streak.current")}
						</Text>
					</View>
					<View style={styles.heroDivider} />
					<View style={styles.heroStat}>
						<Text variant="h2" tabular>
							{t.number(totals.active)}
						</Text>
						<Text variant="tiny" tone="muted">
							{t.t("insights.activeHabits")}
						</Text>
					</View>
				</View>
			</Card>

			<SectionLabel
				right={
					identities.length ? (
						<Pressable
							onPress={() => router.push("/identity")}
							hitSlop={10}
							accessibilityRole="link"
						>
							<Text variant="tiny" weight="semibold" tone="accent">
								{t.t("common.seeAll")}
							</Text>
						</Pressable>
					) : null
				}
			>
				{t.x("you.identitiesTitle")}
			</SectionLabel>
			{identities.length === 0 ? (
				<Card tone="sunken" padding={16} style={styles.block}>
					<Text variant="small" tone="muted">
						{t.x("you.noIdentities")}
					</Text>
				</Card>
			) : (
				<View style={[styles.identities, styles.block]}>
					{identities.slice(0, 4).map(({ identity, votes, recentVotes, habits: linked }) => {
						const tone = toneOf(identity.color);
						return (
							<Pressable
								key={identity.id}
								onPress={() => router.push("/identity")}
								accessibilityRole="button"
								accessibilityLabel={`${identity.statement}, ${t.tp("common.votes", votes)}`}
								style={({ pressed }) => [styles.identity, pressed && { opacity: 0.85 }]}
							>
								<View style={[styles.identityEmoji, { backgroundColor: tone.soft }]}>
									<Text style={styles.emojiText} allowFontScaling={false}>
										{identity.emoji}
									</Text>
								</View>
								<View style={{ flex: 1, gap: 2 }}>
									<Text variant="h3" numberOfLines={2}>
										{identity.statement}
									</Text>
									<Text variant="small" tone="muted" numberOfLines={1}>
										{t.tp("common.habits", linked.length)}
									</Text>
								</View>
								<View style={styles.votes}>
									<Text variant="display" tabular color={tone.text}>
										{t.number(votes)}
									</Text>
									{recentVotes > 0 ? (
										<Text variant="tiny" weight="semibold" tone="success" tabular>
											{t.x("you.thisWeek", { count: t.number(recentVotes) })}
										</Text>
									) : null}
								</View>
							</Pressable>
						);
					})}
				</View>
			)}

			<SectionLabel>{t.x("you.explore")}</SectionLabel>
			<ListGroup style={styles.block}>
				<ListRow
					icon={Fingerprint}
					iconColor={colors.accent}
					iconBg={colors.accentSoft}
					title={t.t("nav.identity")}
					subtitle={t.t("identity.subtitle")}
					chevron
					onPress={() => router.push("/identity")}
					testID="link-identity"
				/>
				<ListSeparator />
				<ListRow
					icon={ChartColumn}
					iconColor={toneOf("sky").text}
					iconBg={toneOf("sky").soft}
					title={t.t("nav.insights")}
					subtitle={t.t("insights.subtitle")}
					chevron
					onPress={() => router.push("/insights")}
					testID="link-insights"
				/>
				<ListSeparator />
				<ListRow
					icon={ClipboardList}
					iconColor={toneOf("emerald").text}
					iconBg={toneOf("emerald").soft}
					title={t.t("nav.scorecard")}
					subtitle={t.t("scorecard.subtitle")}
					chevron
					onPress={() => router.push("/scorecard")}
					testID="link-scorecard"
				/>
				<ListSeparator />
				<ListRow
					icon={Settings}
					title={t.t("nav.settings")}
					subtitle={t.x("you.settingsHint")}
					chevron
					onPress={() => router.push("/settings")}
					testID="link-settings"
					right={
						sync.status === "signed-out" ? null : sync.status === "error" ? (
							<CloudAlert size={16} color={colors.danger} />
						) : (
							<Cloud size={16} color={colors.textSubtle} />
						)
					}
				/>
			</ListGroup>
			<Text variant="tiny" tone="subtle" align="center" style={styles.attribution}>
				{t.t("app.attribution")}
			</Text>
		</Screen>
	);
}

const useStyles = makeStyles((t) => ({
	hero: { marginBottom: 24, gap: 16 },
	heroMain: { gap: 2 },
	heroStats: {
		flexDirection: "row",
		alignItems: "center",
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
		paddingTop: 14,
	},
	heroStat: { flex: 1, gap: 2 },
	heroDivider: {
		width: 1,
		alignSelf: "stretch",
		backgroundColor: t.colors.border,
		marginHorizontal: 16,
	},
	inline: { flexDirection: "row", alignItems: "center", gap: 6 },
	block: { marginBottom: 24 },
	identities: { gap: 10 },
	identity: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		padding: 14,
		borderRadius: t.radii.xl - 2,
		backgroundColor: t.colors.surface,
		borderWidth: 1,
		borderColor: t.colors.border,
		...t.cardShadow,
	},
	identityEmoji: {
		width: 46,
		height: 46,
		borderRadius: 15,
		alignItems: "center",
		justifyContent: "center",
	},
	emojiText: { fontSize: 22, lineHeight: 28 },
	votes: { alignItems: "flex-end" },
	attribution: { marginTop: 4, paddingHorizontal: 24 },
}));
