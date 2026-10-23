import { Field, TimeField } from "@/components/editor/fields";
import { EmptyState } from "@/components/empty-state";
import { Ellipsis, Equal, Minus, Plus, ShieldOff, Sprout, Trash2 } from "@/components/icons";
import { ActionList } from "@/components/sheet/action-list";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { SectionLabel } from "@/components/ui/section-label";
import { SmartTextField } from "@/components/ui/smart-text-field";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { type Theme, makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import type { ScorecardItem, ScorecardRating } from "@atomic/core";
import { useActions, useScorecard, useText } from "@atomic/core/react";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

const RATINGS: { rating: ScorecardRating; icon: typeof Plus }[] = [
	{ rating: "positive", icon: Plus },
	{ rating: "neutral", icon: Equal },
	{ rating: "negative", icon: Minus },
];

function ratingColor(rating: ScorecardRating, theme: Theme) {
	if (rating === "positive") return { fg: theme.colors.success, bg: theme.colors.successSoft };
	if (rating === "negative") return { fg: theme.colors.danger, bg: theme.colors.dangerSoft };
	return { fg: theme.colors.textMuted, bg: theme.colors.sunken };
}

export default function ScorecardScreen() {
	const t = useT();
	const theme = useTheme();
	const styles = useStyles();
	const actions = useActions();
	const items = useScorecard();
	// Labels show in the content language (template text, AI translation); the menu and
	// "Make it a habit" use what the user sees, and editing changes the original.
	const text = useText();
	const [label, setLabel] = useState("");
	const [time, setTime] = useState<string | null>(null);
	const [menu, setMenu] = useState<ScorecardItem | null>(null);

	const counts = { positive: 0, neutral: 0, negative: 0 };
	for (const item of items) counts[item.rating]++;

	const add = () => {
		if (!label.trim()) return;
		actions.createScorecardItem({ label, time });
		haptics.light();
		setLabel("");
	};

	return (
		<Screen back title={t.t("scorecard.title")} keyboard testID="scorecard-screen">
			<ScreenTitle title={t.t("scorecard.title")} subtitle={t.t("scorecard.subtitle")} />
			<Text tone="muted" style={styles.intro}>
				{t.t("scorecard.intro")}
			</Text>

			{items.length ? (
				<View style={styles.summary}>
					{RATINGS.map(({ rating, icon: Icon }) => {
						const c = ratingColor(rating, theme);
						return (
							<View key={rating} style={[styles.summaryPill, { backgroundColor: c.bg }]}>
								<Icon size={14} color={c.fg} strokeWidth={2.6} />
								<Text variant="small" weight="bold" color={c.fg} tabular>
									{t.number(counts[rating])}
								</Text>
								<Text variant="small" color={c.fg}>
									{t.t(`scorecard.rating.${rating}`)}
								</Text>
							</View>
						);
					})}
				</View>
			) : null}

			{items.length === 0 ? (
				<EmptyState compact title={t.t("scorecard.empty")} body={t.t("scorecard.emptyBody")} />
			) : (
				<Card padding={0} style={styles.list}>
					{items.map((item, index) => (
						<Animated.View
							key={item.id}
							entering={FadeIn}
							exiting={FadeOut}
							layout={LinearTransition.springify().damping(20)}
							style={[styles.row, index > 0 && styles.separator]}
						>
							<View style={styles.rowTop}>
								<Text variant="small" weight="semibold" tone="subtle" tabular style={styles.time}>
									{item.time ?? "—"}
								</Text>
								<Text weight="medium" style={{ flex: 1 }}>
									{text.scorecard(item, "label")}
								</Text>
								<IconButton
									icon={Ellipsis}
									size={32}
									iconSize={18}
									accessibilityLabel={t.x("a11y.habitActions", {
										habit: text.scorecard(item, "label"),
									})}
									onPress={() => setMenu(item)}
								/>
							</View>
							<View style={styles.ratings} accessibilityRole="radiogroup">
								{RATINGS.map(({ rating, icon: Icon }) => {
									const selected = item.rating === rating;
									const c = ratingColor(rating, theme);
									return (
										<Pressable
											key={rating}
											onPress={() => {
												haptics.selection();
												actions.updateScorecardItem(item.id, { rating });
											}}
											accessibilityRole="radio"
											accessibilityState={{ selected }}
											accessibilityLabel={t.t(`scorecard.rating.${rating}`)}
											style={[
												styles.rating,
												selected
													? { backgroundColor: c.bg, borderColor: c.fg }
													: { borderColor: theme.colors.border },
											]}
										>
											<Icon
												size={15}
												color={selected ? c.fg : theme.colors.textSubtle}
												strokeWidth={2.6}
											/>
											<Text
												variant="tiny"
												weight="semibold"
												color={selected ? c.fg : theme.colors.textSubtle}
											>
												{t.t(`scorecard.rating.${rating}`)}
											</Text>
										</Pressable>
									);
								})}
							</View>
						</Animated.View>
					))}
				</Card>
			)}

			<SectionLabel>{t.t("scorecard.add")}</SectionLabel>
			<Card padding={16} style={styles.add}>
				<SmartTextField
					field="scorecard.label"
					value={label}
					onChangeText={setLabel}
					placeholder={t.t("scorecard.placeholder")}
					onSubmitEditing={add}
					returnKeyType="done"
					maxLength={160}
					accessibilityLabel={t.t("scorecard.add")}
					testID="scorecard-input"
				/>
				<Field label={t.t("scorecard.time")}>
					<TimeField value={time} onChange={setTime} />
				</Field>
				<Button label={t.t("scorecard.add")} icon={Plus} disabled={!label.trim()} onPress={add} />
			</Card>

			<Sheet
				open={Boolean(menu)}
				onClose={() => setMenu(null)}
				title={menu ? text.scorecard(menu, "label") : undefined}
			>
				{menu ? (
					<ActionList
						actions={[
							menu.rating === "negative"
								? {
										key: "break",
										label: t.t("scorecard.breakHabit"),
										icon: ShieldOff,
										tone: "accent",
										onPress: () => {
											setMenu(null);
											router.push({
												pathname: "/habit/editor",
												params: { name: text.scorecard(menu, "label"), kind: "break" },
											});
										},
									}
								: {
										key: "build",
										label: t.t("scorecard.makeHabit"),
										icon: Sprout,
										tone: "accent",
										onPress: () => {
											setMenu(null);
											router.push({
												pathname: "/habit/editor",
												params: { name: text.scorecard(menu, "label"), kind: "build" },
											});
										},
									},
							{
								key: "delete",
								label: t.t("common.delete"),
								icon: Trash2,
								tone: "danger",
								onPress: () => {
									const { label: oldLabel, rating, time: oldTime } = menu;
									actions.deleteScorecardItem(menu.id);
									setMenu(null);
									showToast(t.t("common.deleted"), {
										action: {
											label: t.t("common.undo"),
											onPress: () =>
												actions.createScorecardItem({ label: oldLabel, rating, time: oldTime }),
										},
									});
								},
							},
						]}
					/>
				) : null}
			</Sheet>
		</Screen>
	);
}

const useStyles = makeStyles((t) => ({
	intro: { marginBottom: 18 },
	summary: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
	summaryPill: {
		flexDirection: "row",
		alignItems: "center",
		gap: 5,
		paddingHorizontal: 10,
		paddingVertical: 6,
		borderRadius: 999,
	},
	list: { marginBottom: 24 },
	row: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
	separator: { borderTopWidth: 1, borderTopColor: t.colors.border },
	rowTop: { flexDirection: "row", alignItems: "center", gap: 12 },
	time: { width: 44 },
	ratings: { flexDirection: "row", gap: 8, paddingLeft: 56 },
	rating: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
		height: 32,
		paddingHorizontal: 10,
		borderRadius: 999,
		borderWidth: 1,
	},
	add: { gap: 14, marginBottom: 12 },
}));
