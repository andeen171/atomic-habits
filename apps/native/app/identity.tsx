import { AiSuggestButton } from "@/components/ai/ai-suggest-button";
import { ColorPicker, EmojiPicker, Field } from "@/components/editor/fields";
import { EmptyState } from "@/components/empty-state";
import { Ellipsis, Pencil, Plus, Trash2 } from "@/components/icons";
import { PrincipleQuote } from "@/components/principles/principle-quote";
import { ActionList } from "@/components/sheet/action-list";
import { ConfirmSheet } from "@/components/sheet/confirm-sheet";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { IconButton } from "@/components/ui/icon-button";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { SectionLabel } from "@/components/ui/section-label";
import { SmartTextField } from "@/components/ui/smart-text-field";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { type HabitColor, type IdentityStats, identityTemplates } from "@atomic/core";
import { useActions, useIdentityStats } from "@atomic/core/react";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

export default function IdentityScreen() {
	const t = useT();
	const styles = useStyles();
	const actions = useActions();
	const stats = useIdentityStats();
	const [statement, setStatement] = useState("");
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const [editing, setEditing] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);

	const suggestions = useMemo(() => {
		const existing = new Set(stats.map((s) => s.identity.statement.toLowerCase()));
		return identityTemplates(t.locale).filter((tpl) => !existing.has(tpl.statement.toLowerCase()));
	}, [stats, t.locale]);

	const add = (input: { statement: string; emoji?: string; color?: HabitColor }) => {
		if (!input.statement.trim()) return;
		actions.createIdentity(input);
		haptics.success();
		setStatement("");
	};

	const menuIdentity = stats.find((s) => s.identity.id === menuFor)?.identity;

	return (
		<Screen back title={t.t("identity.title")} keyboard testID="identity-screen">
			<ScreenTitle title={t.t("identity.title")} subtitle={t.t("identity.subtitle")} />
			<PrincipleQuote id="identity" variant="card" />
			<Card tone="accent" padding={20} style={styles.quote}>
				<Text variant="display" italic>
					{`“${t.t("identity.quote")}”`}
				</Text>
				<Text variant="small" weight="semibold" tone="muted">
					{t.x("onboarding.attribution")}
				</Text>
			</Card>

			{stats.length === 0 ? (
				<EmptyState compact title={t.t("identity.empty")} body={t.t("identity.emptyBody")} />
			) : (
				<View style={styles.list}>
					{stats.map((s) => (
						<IdentityCard key={s.identity.id} stats={s} onMenu={() => setMenuFor(s.identity.id)} />
					))}
				</View>
			)}

			<SectionLabel>{t.t("identity.add")}</SectionLabel>
			<Card padding={16} style={styles.addCard}>
				<SmartTextField
					field="identity.statement"
					value={statement}
					onChangeText={setStatement}
					placeholder={t.t("identity.placeholder")}
					onSubmitEditing={() => add({ statement })}
					returnKeyType="done"
					maxLength={120}
					accessibilityLabel={t.t("identity.add")}
					testID="identity-input"
					right={
						<AiSuggestButton
							kind="identity.statement"
							label={t.t("identity.add")}
							input={() => ({ goal: statement.trim() })}
							onPick={setStatement}
						/>
					}
				/>
				<Button
					label={t.t("identity.add")}
					icon={Plus}
					disabled={!statement.trim()}
					onPress={() => add({ statement })}
				/>
				{suggestions.length ? (
					<View style={{ gap: 8 }}>
						<Text variant="label">{t.t("identity.suggestions")}</Text>
						<View style={styles.suggestions}>
							{suggestions.map((tpl) => (
								<Chip
									key={tpl.key}
									size="sm"
									label={`${tpl.emoji} ${tpl.statement}`}
									onPress={() =>
										add({ statement: tpl.statement, emoji: tpl.emoji, color: tpl.color })
									}
								/>
							))}
						</View>
					</View>
				) : null}
			</Card>

			<Sheet
				open={Boolean(menuFor)}
				onClose={() => setMenuFor(null)}
				title={menuIdentity?.statement}
			>
				<ActionList
					actions={[
						{
							key: "edit",
							label: t.t("common.edit"),
							icon: Pencil,
							onPress: () => {
								setEditing(menuFor);
								setMenuFor(null);
							},
						},
						{
							key: "habit",
							label: t.t("identity.linkHabit"),
							icon: Plus,
							onPress: () => {
								const id = menuFor;
								setMenuFor(null);
								if (id) router.push({ pathname: "/habit/editor", params: { identityId: id } });
							},
						},
						{
							key: "delete",
							label: t.t("common.delete"),
							icon: Trash2,
							tone: "danger",
							onPress: () => {
								setDeleting(menuFor);
								setMenuFor(null);
							},
						},
					]}
				/>
			</Sheet>
			<EditIdentitySheet
				stats={stats.find((s) => s.identity.id === editing)}
				onClose={() => setEditing(null)}
			/>
			<ConfirmSheet
				open={Boolean(deleting)}
				title={t.t("identity.deleteTitle")}
				body={t.t("identity.deleteBody")}
				confirmLabel={t.t("common.delete")}
				destructive
				onClose={() => setDeleting(null)}
				onConfirm={() => {
					if (deleting) actions.deleteIdentity(deleting);
					showToast(t.t("common.deleted"));
				}}
			/>
		</Screen>
	);
}

function IdentityCard({ stats, onMenu }: { stats: IdentityStats; onMenu: () => void }) {
	const t = useT();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const { identity, votes, recentVotes, habits } = stats;
	const tone = toneOf(identity.color);
	return (
		<Animated.View
			entering={FadeIn}
			exiting={FadeOut}
			layout={LinearTransition.springify().damping(20)}
			style={styles.card}
		>
			<View style={styles.cardTop}>
				<View style={[styles.emojiTile, { backgroundColor: tone.soft }]}>
					<Text style={{ fontSize: 26, lineHeight: 32 }} allowFontScaling={false}>
						{identity.emoji}
					</Text>
				</View>
				<Text variant="display" style={{ flex: 1 }}>
					{identity.statement}
				</Text>
				<IconButton
					icon={Ellipsis}
					size={34}
					accessibilityLabel={t.t("common.more")}
					onPress={onMenu}
				/>
			</View>
			<View style={styles.votesRow}>
				<View>
					<Text variant="label">{t.t("identity.votes")}</Text>
					<Text variant="hero" tabular color={tone.text}>
						{t.number(votes)}
					</Text>
				</View>
				{recentVotes > 0 ? (
					<View style={[styles.recent, { backgroundColor: tone.softer }]}>
						<Text variant="small" weight="bold" color={tone.text} tabular>
							{t.x("you.thisWeek", { count: t.number(recentVotes) })}
						</Text>
					</View>
				) : null}
			</View>
			<AtomField votes={votes} color={tone.fill} />
			{votes > 0 ? (
				<Text variant="small" tone="muted">
					{t.t("identity.evidenceBody", { votes: t.number(votes) })}
				</Text>
			) : null}
			<View style={styles.habits}>
				{habits.length === 0 ? (
					<Text variant="small" tone="subtle">
						{t.t("identity.noHabits")}
					</Text>
				) : (
					habits.map((habit) => (
						<Chip
							key={habit.id}
							size="sm"
							label={`${habit.emoji} ${habit.name}`}
							onPress={() => router.push({ pathname: "/habit/[id]", params: { id: habit.id } })}
						/>
					))
				)}
				<Chip
					size="sm"
					icon={Plus}
					label={t.t("identity.linkHabit")}
					onPress={() =>
						router.push({ pathname: "/habit/editor", params: { identityId: identity.id } })
					}
				/>
			</View>
		</Animated.View>
	);
}

const DOT_IDS = Array.from({ length: 200 }, (_, i) => i);

/** A field of small "atoms": 1 dot = 1 vote up to 200, then each dot is several votes. */
function AtomField({ votes, color }: { votes: number; color: string }) {
	const t = useT();
	const [width, setWidth] = useState(0);
	const per = votes > 200 ? Math.ceil(votes / 200) : 1;
	const dots = Math.min(200, Math.ceil(votes / per));
	const size = 7;
	const gap = 4;
	const cols = Math.max(1, Math.floor((width + gap) / (size + gap)));
	const rows = Math.ceil(dots / cols);
	const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
	if (votes === 0) return null;
	return (
		<View
			onLayout={onLayout}
			accessible
			accessibilityRole="image"
			accessibilityLabel={t.x("a11y.votes", { votes: t.number(votes) })}
		>
			{width ? (
				<Svg width={width} height={rows * (size + gap)}>
					{DOT_IDS.slice(0, dots).map((i) => {
						const col = i % cols;
						const row = Math.floor(i / cols);
						// Deterministic shimmer so the field feels organic.
						const opacity = 0.45 + (((i * 37) % 11) / 10) * 0.55;
						return (
							<Circle
								key={i}
								cx={col * (size + gap) + size / 2}
								cy={row * (size + gap) + size / 2}
								r={size / 2}
								fill={color}
								opacity={opacity}
							/>
						);
					})}
				</Svg>
			) : null}
		</View>
	);
}

function EditIdentitySheet({
	stats,
	onClose,
}: { stats: IdentityStats | undefined; onClose: () => void }) {
	const t = useT();
	const actions = useActions();
	const identity = stats?.identity;
	const [draft, setDraft] = useState<{
		statement: string;
		emoji: string;
		color: HabitColor;
	} | null>(null);
	const value =
		draft ??
		(identity
			? { statement: identity.statement, emoji: identity.emoji, color: identity.color }
			: null);
	return (
		<Sheet
			open={Boolean(identity)}
			onClose={() => {
				setDraft(null);
				onClose();
			}}
			title={t.t("common.edit")}
			scroll
			footer={
				<Button
					label={t.t("common.save")}
					size="lg"
					disabled={!value?.statement.trim()}
					onPress={() => {
						if (identity && value) actions.updateIdentity(identity.id, value);
						haptics.success();
						setDraft(null);
						onClose();
					}}
				/>
			}
		>
			{value ? (
				<View style={{ gap: 18 }}>
					<SmartTextField
						field="identity.statement"
						value={value.statement}
						onChangeText={(statement) => setDraft({ ...value, statement })}
						placeholder={t.t("identity.placeholder")}
						maxLength={120}
						accessibilityLabel={t.t("identity.placeholder")}
					/>
					<Field label={t.t("form.emoji")}>
						<EmojiPicker value={value.emoji} onChange={(emoji) => setDraft({ ...value, emoji })} />
					</Field>
					<Field label={t.t("form.color")}>
						<ColorPicker value={value.color} onChange={(color) => setDraft({ ...value, color })} />
					</Field>
				</View>
			) : null}
		</Sheet>
	);
}

const useStyles = makeStyles((t) => ({
	quote: { gap: 10, marginBottom: 24 },
	list: { gap: 14, marginBottom: 28 },
	card: {
		backgroundColor: t.colors.surface,
		borderRadius: t.radii.xl,
		borderWidth: 1,
		borderColor: t.colors.border,
		padding: 18,
		gap: 14,
		...t.cardShadow,
	},
	cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
	emojiTile: {
		width: 52,
		height: 52,
		borderRadius: 17,
		alignItems: "center",
		justifyContent: "center",
	},
	votesRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
	recent: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginBottom: 8 },
	habits: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	addCard: { gap: 12, marginBottom: 12 },
	suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
}));
