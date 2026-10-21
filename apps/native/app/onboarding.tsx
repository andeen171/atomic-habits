import { CompoundChart, CompoundLegend } from "@/components/charts/compound-chart";
import { identityTemplateFor } from "@/components/editor/fields";
import { Check, ChevronLeft, PenLine } from "@/components/icons";
import { Logo } from "@/components/logo";
import { ConfirmSheet } from "@/components/sheet/confirm-sheet";
import { TrackerBadge } from "@/components/trackers/tracker-badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useAuthSheet } from "@/lib/account";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type HabitTemplate,
	type IdentityTemplate,
	hasAnyData,
	identityTemplates,
} from "@atomic/core";
import { useActions, useAtomic, useSyncState } from "@atomic/core/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeInRight, FadeOutLeft } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const STEPS = 7;
const MAX_PICKS = 3;
const STEP_IDS = Array.from({ length: STEPS }, (_, i) => i);

/** A starter habit with the identity it votes for (it wears that identity's icon, D12). */
type TemplateHabit = HabitTemplate & { identityKey: string; identityEmoji: string };

export default function OnboardingScreen() {
	const t = useT();
	const insets = useSafeAreaInsets();
	const styles = useStyles();
	const actions = useActions();
	const reduceMotion = useReduceMotion();
	const [step, setStep] = useState(0);
	const [name, setName] = useState("");
	const [picked, setPicked] = useState<string[]>([]);
	const [custom, setCustom] = useState("");
	const [writingCustom, setWritingCustom] = useState(false);
	const [habitPicks, setHabitPicks] = useState<string[] | null>(null);
	const templates = useMemo(() => identityTemplates(t.locale), [t.locale]);
	// The same check as Today's "Explore with sample data": the sample replaces everything.
	const hasData = useAtomic((s) => hasAnyData(s.data));
	const [confirmDemo, setConfirmDemo] = useState(false);
	const openAuth = useAuthSheet((s) => s.openAuth);
	const signedIn = useSyncState(syncController).user !== null;
	const wasSignedIn = useRef(signedIn);
	const scrollRef = useRef<ScrollView>(null);

	// A second device signs in from the welcome step: once signed in (after the merge
	// question, when this device has data), the account's data is on its way, so
	// onboarding is done (as on web).
	useEffect(() => {
		if (signedIn && !wasSignedIn.current) actions.updateSettings({ onboarded: true });
		wasSignedIn.current = signedIn;
	}, [signedIn, actions]);

	const explore = () => {
		haptics.success();
		actions.loadDemoData(t.locale);
		actions.updateSettings({ displayName: name.trim() });
	};

	const pickedTemplates = useMemo(
		() => templates.filter((identity) => picked.includes(identity.key)),
		[templates, picked],
	);
	const starter: TemplateHabit[] = useMemo(
		() =>
			pickedTemplates.flatMap((identity) =>
				identity.habits.map((h) => ({
					...h,
					identityKey: identity.key,
					identityEmoji: identity.emoji,
				})),
			),
		[pickedTemplates],
	);
	const defaultHabitPicks = useMemo(() => {
		const firsts = picked
			.map((key) => starter.find((h) => h.identityKey === key)?.key)
			.filter((key): key is string => Boolean(key));
		return firsts.slice(0, MAX_PICKS);
	}, [picked, starter]);
	const chosenHabits = habitPicks ?? defaultHabitPicks;
	// A written identity takes one of the MAX_PICKS slots, like a picked template.
	const customCount = custom.trim() ? 1 : 0;
	const identitiesFull = picked.length + customCount >= MAX_PICKS;
	const canWriteCustom = customCount > 0 || picked.length < MAX_PICKS;

	const finish = (create: boolean) => {
		if (create) {
			const ids = new Map<string, string>();
			for (const identity of templates.filter((i) => picked.includes(i.key))) {
				const created = actions.createIdentity({
					statement: identity.statement,
					emoji: identity.emoji,
					color: identity.color,
				});
				ids.set(identity.key, created.id);
			}
			if (custom.trim() && picked.length < MAX_PICKS) {
				// A statement that matches a template identity gets its icon and color, as in the editor.
				const matched = identityTemplateFor({ statement: custom });
				actions.createIdentity({
					statement: custom.trim(),
					emoji: matched?.emoji ?? "🌱",
					color: matched?.color ?? "ember",
				});
			}
			for (const habit of starter.filter((h) => chosenHabits.includes(h.key))) {
				const { key: _key, requires: _requires, identityKey, identityEmoji, ...fields } = habit;
				// Same icon rules as the editor (D12): nobody picked an icon here, so the
				// habit wears its identity's emoji and follows it.
				actions.createHabit({
					...fields,
					emoji: identityEmoji,
					emojiAuto: true,
					identityId: ids.get(identityKey) ?? null,
				});
			}
			haptics.success();
		}
		actions.updateSettings({ displayName: name.trim(), onboarded: true });
	};

	// Every step starts at its top: picking identities low on the list would otherwise
	// open the next step scrolled past its title.
	const goTo = (target: number) => {
		scrollRef.current?.scrollTo({ y: 0, animated: false });
		setStep(target);
	};
	const next = () => {
		haptics.selection();
		if (step === STEPS - 1) finish(true);
		else goTo(step + 1);
	};
	const back = () => {
		haptics.selection();
		goTo(Math.max(0, step - 1));
	};

	const toggleIdentity = (identity: IdentityTemplate) => {
		haptics.selection();
		setHabitPicks(null);
		setPicked((list) =>
			list.includes(identity.key)
				? list.filter((k) => k !== identity.key)
				: list.length + customCount >= MAX_PICKS
					? list
					: [...list, identity.key],
		);
	};
	const toggleHabit = (key: string) => {
		haptics.selection();
		const current = chosenHabits;
		setHabitPicks(
			current.includes(key)
				? current.filter((k) => k !== key)
				: current.length >= MAX_PICKS
					? current
					: [...current, key],
		);
	};

	const primaryLabel =
		step === 0
			? t.t("onboarding.begin")
			: step === STEPS - 1
				? t.t("onboarding.start")
				: t.t("common.continue");

	return (
		<KeyboardAvoidingView
			style={styles.root}
			behavior={Platform.OS === "web" ? undefined : "padding"}
		>
			<View style={[styles.top, { paddingTop: insets.top + 8 }]}>
				{step > 0 ? (
					<IconButton
						icon={ChevronLeft}
						variant="soft"
						size={38}
						accessibilityLabel={t.t("common.back")}
						onPress={back}
					/>
				) : (
					<View style={{ width: 38 }} />
				)}
				<View
					style={styles.dots}
					accessible
					accessibilityLabel={t.x("onboarding.stepA11y", { current: step + 1, total: STEPS })}
				>
					{STEP_IDS.map((i) => (
						<View
							key={i}
							style={[styles.dot, i === step && styles.dotActive, i < step && styles.dotDone]}
						/>
					))}
				</View>
				<Pressable
					onPress={() => finish(false)}
					hitSlop={12}
					accessibilityRole="button"
					style={styles.skip}
					testID="onboarding-skip"
				>
					<Text variant="small" weight="semibold" tone="muted">
						{t.t("common.skip")}
					</Text>
				</Pressable>
			</View>

			<ScrollView
				ref={scrollRef}
				contentContainerStyle={styles.content}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={false}
			>
				<Animated.View
					key={step}
					entering={reduceMotion ? undefined : FadeInRight.duration(260)}
					exiting={reduceMotion ? undefined : FadeOutLeft.duration(160)}
					style={styles.step}
				>
					{step === 0 ? <Welcome /> : null}
					{step === 1 ? (
						<StepBody title={t.t("onboarding.compoundTitle")} body={t.t("onboarding.compoundBody")}>
							<View style={styles.chartCard}>
								<CompoundChart days={365} height={200} />
								<CompoundLegend style={styles.chartLegend} />
							</View>
						</StepBody>
					) : null}
					{step === 2 ? <Systems /> : null}
					{step === 3 ? (
						<StepBody title={t.t("onboarding.nameTitle")}>
							<TextField
								value={name}
								onChangeText={setName}
								placeholder={t.t("onboarding.namePlaceholder")}
								size="lg"
								autoFocus
								returnKeyType="next"
								onSubmitEditing={next}
								maxLength={60}
								autoComplete="given-name"
								textContentType="givenName"
								testID="onboarding-name"
							/>
						</StepBody>
					) : null}
					{step === 4 ? (
						<StepBody title={t.t("onboarding.identityTitle")} body={t.t("onboarding.identityBody")}>
							<Text variant="label" style={{ marginBottom: 10 }}>
								{t.x("onboarding.pickUpTo")}
							</Text>
							<View style={styles.grid}>
								{templates.map((identity) => (
									<IdentityTile
										key={identity.key}
										identity={identity}
										selected={picked.includes(identity.key)}
										disabled={!picked.includes(identity.key) && identitiesFull}
										onPress={() => toggleIdentity(identity)}
									/>
								))}
							</View>
							{(writingCustom || custom) && canWriteCustom ? (
								<TextField
									value={custom}
									onChangeText={setCustom}
									placeholder={t.t("identity.placeholder")}
									autoFocus={writingCustom}
									maxLength={120}
									containerStyle={{ marginTop: 12 }}
								/>
							) : (
								<Button
									label={t.t("onboarding.customIdentity")}
									icon={PenLine}
									variant="secondary"
									disabled={!canWriteCustom}
									onPress={() => setWritingCustom(true)}
									style={{ marginTop: 12 }}
								/>
							)}
						</StepBody>
					) : null}
					{step === 5 ? (
						<StepBody title={t.t("onboarding.habitsTitle")} body={t.t("onboarding.habitsBody")}>
							{starter.length === 0 ? (
								<Text tone="muted">{t.t("identity.noHabits")}</Text>
							) : (
								<View style={{ gap: 22 }}>
									{/* Grouped by the identity each habit votes for; each wears that identity's icon. */}
									{pickedTemplates.map((identity) => (
										<View key={identity.key} style={{ gap: 10 }}>
											<View style={styles.groupHeader} accessibilityRole="header">
												<Text style={styles.groupEmoji} allowFontScaling={false}>
													{identity.emoji}
												</Text>
												<Text variant="small" weight="semibold" tone="muted" style={{ flex: 1 }}>
													{identity.statement}
												</Text>
											</View>
											{starter
												.filter((habit) => habit.identityKey === identity.key)
												.map((habit) => (
													<HabitTile
														key={habit.key}
														habit={habit}
														selected={chosenHabits.includes(habit.key)}
														disabled={
															!chosenHabits.includes(habit.key) && chosenHabits.length >= MAX_PICKS
														}
														onPress={() => toggleHabit(habit.key)}
													/>
												))}
										</View>
									))}
								</View>
							)}
						</StepBody>
					) : null}
					{step === 6 ? (
						<Ready habits={starter.filter((habit) => chosenHabits.includes(habit.key))} />
					) : null}
				</Animated.View>
			</ScrollView>

			<View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 4 }]}>
				<Button label={primaryLabel} size="lg" onPress={next} fullWidth testID="onboarding-next" />
				{step === 0 ? (
					<>
						<Button
							label={t.t("onboarding.explore")}
							variant="ghost"
							size="lg"
							fullWidth
							onPress={() => (hasData ? setConfirmDemo(true) : explore())}
							testID="onboarding-explore"
						/>
						<View style={styles.haveAccount}>
							<Text variant="small" tone="muted">
								{t.t("account.haveAccount")}
							</Text>
							<PressableScale
								onPress={() => openAuth("signIn")}
								hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
								accessibilityRole="button"
								style={styles.signIn}
								testID="onboarding-sign-in"
							>
								<Text variant="small" weight="semibold" tone="accent">
									{t.t("settings.signIn")}
								</Text>
							</PressableScale>
						</View>
					</>
				) : null}
			</View>
			<ConfirmSheet
				open={confirmDemo}
				title={t.t("settings.demo")}
				body={t.t("settings.demoConfirm")}
				confirmLabel={t.t("common.confirm")}
				onClose={() => setConfirmDemo(false)}
				onConfirm={explore}
			/>
		</KeyboardAvoidingView>
	);
}

function StepBody({
	title,
	body,
	children,
}: { title: string; body?: string; children?: ReactNode }) {
	return (
		<View style={{ gap: 12 }}>
			<Text variant="title" accessibilityRole="header">
				{title}
			</Text>
			{body ? <Text tone="muted">{body}</Text> : null}
			<View style={{ marginTop: 12 }}>{children}</View>
		</View>
	);
}

function Welcome() {
	const t = useT();
	const styles = useStyles();
	return (
		<View style={styles.welcome}>
			<Animated.View entering={FadeIn.duration(600)} style={styles.logo}>
				<Logo size={112} />
			</Animated.View>
			<Text variant="label" tone="accent" align="center">
				{t.t("app.name")}
			</Text>
			<Text variant="hero" align="center" accessibilityRole="header">
				{t.t("onboarding.welcomeTitle")}
			</Text>
			<Text tone="muted" align="center" style={{ maxWidth: 320 }}>
				{t.t("onboarding.welcomeBody")}
			</Text>
		</View>
	);
}

function Systems() {
	const t = useT();
	const { colors } = useTheme();
	return (
		<View style={{ gap: 18 }}>
			<Text variant="label" tone="accent">
				{t.t("onboarding.systemsTitle")}
			</Text>
			<View
				style={{ borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 18, gap: 10 }}
			>
				<Text variant="title" italic>
					{`“${t.t("onboarding.systemsQuote")}”`}
				</Text>
				<Text variant="small" weight="semibold" tone="muted">
					{t.x("onboarding.attribution")}
				</Text>
			</View>
			<Text tone="muted">{t.t("onboarding.systemsBody")}</Text>
		</View>
	);
}

function Ready({ habits }: { habits: TemplateHabit[] }) {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	return (
		<View style={styles.welcome}>
			<Animated.View entering={FadeIn.duration(500)} style={styles.readyBadge}>
				<Check size={44} color={colors.onAccent} strokeWidth={2.6} />
			</Animated.View>
			<Text variant="hero" align="center" accessibilityRole="header">
				{t.t("onboarding.readyTitle")}
			</Text>
			<Text tone="muted" align="center">
				{t.t("onboarding.readyBody")}
			</Text>
			{habits.length ? (
				<View style={styles.readyHabits}>
					{habits.map((habit) => (
						<View key={habit.key} style={styles.readyHabit}>
							<View style={[styles.readyHabitEmoji, { backgroundColor: toneOf(habit.color).soft }]}>
								<Text style={{ fontSize: 14, lineHeight: 18 }} allowFontScaling={false}>
									{habit.identityEmoji}
								</Text>
							</View>
							<Text variant="small" weight="medium" style={{ flexShrink: 1 }}>
								{habit.name}
							</Text>
						</View>
					))}
				</View>
			) : null}
		</View>
	);
}

function IdentityTile({
	identity,
	selected,
	disabled,
	onPress,
}: {
	identity: IdentityTemplate;
	selected: boolean;
	disabled: boolean;
	onPress: () => void;
}) {
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(identity.color);
	return (
		<PressableScale
			onPress={onPress}
			disabled={disabled}
			scaleTo={0.96}
			accessibilityRole="checkbox"
			accessibilityState={{ checked: selected, disabled }}
			accessibilityLabel={identity.statement}
			testID={`identity-${identity.key}`}
			style={[
				styles.tile,
				selected && { borderColor: tone.fill, backgroundColor: tone.softer },
				disabled && { opacity: 0.45 },
			]}
		>
			<View style={styles.tileTop}>
				<Text style={{ fontSize: 26, lineHeight: 32 }} allowFontScaling={false}>
					{identity.emoji}
				</Text>
				<View
					style={[styles.check, selected && { backgroundColor: tone.fill, borderColor: tone.fill }]}
				>
					{selected ? <Check size={13} color={tone.on} strokeWidth={3} /> : null}
				</View>
			</View>
			<Text weight="medium" numberOfLines={3} color={selected ? tone.text : colors.text}>
				{identity.statement}
			</Text>
		</PressableScale>
	);
}

function HabitTile({
	habit,
	selected,
	disabled,
	onPress,
}: {
	habit: TemplateHabit;
	selected: boolean;
	disabled: boolean;
	onPress: () => void;
}) {
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	return (
		<PressableScale
			onPress={onPress}
			disabled={disabled}
			scaleTo={0.98}
			accessibilityRole="checkbox"
			accessibilityState={{ checked: selected, disabled }}
			accessibilityLabel={habit.twoMinute ? `${habit.name}. ${habit.twoMinute}` : habit.name}
			style={[styles.habit, selected && { borderColor: tone.fill }, disabled && { opacity: 0.45 }]}
		>
			{/* The icon the habit gets: its identity's (D12). */}
			<View style={[styles.habitEmoji, { backgroundColor: tone.soft }]}>
				<Text style={{ fontSize: 22, lineHeight: 28 }} allowFontScaling={false}>
					{habit.identityEmoji}
				</Text>
			</View>
			<View style={{ flex: 1, gap: 2 }}>
				<Text weight="semibold">{habit.name}</Text>
				{habit.twoMinute ? (
					<Text variant="small" tone="muted" italic>
						{habit.twoMinute}
					</Text>
				) : null}
				<TrackerBadge template={habit} />
			</View>
			<View
				style={[styles.check, selected && { backgroundColor: tone.fill, borderColor: tone.fill }]}
			>
				{selected ? <Check size={13} color={tone.on} strokeWidth={3} /> : null}
			</View>
		</PressableScale>
	);
}

const useStyles = makeStyles((t) => ({
	root: { flex: 1, backgroundColor: t.colors.bg },
	top: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 16,
		paddingBottom: 8,
	},
	dots: { flexDirection: "row", gap: 6, alignItems: "center" },
	dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.borderStrong },
	dotActive: { width: 22, backgroundColor: t.colors.accent },
	dotDone: { backgroundColor: t.colors.text },
	skip: { minWidth: 38, alignItems: "flex-end", paddingVertical: 8 },
	content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
	step: { flex: 1 },
	welcome: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 24 },
	logo: { marginBottom: 12 },
	chartCard: {
		backgroundColor: t.colors.surface,
		borderRadius: t.radii.xl,
		borderWidth: 1,
		borderColor: t.colors.border,
		padding: 14,
		...t.cardShadow,
	},
	chartLegend: { marginTop: 10, paddingHorizontal: 2 },
	grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
	tile: {
		width: "48%",
		flexGrow: 1,
		minHeight: 112,
		padding: 14,
		borderRadius: t.radii.lg,
		borderWidth: 1.5,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		gap: 10,
	},
	tileTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
	check: {
		width: 22,
		height: 22,
		borderRadius: 11,
		borderWidth: 1.5,
		borderColor: t.colors.borderStrong,
		alignItems: "center",
		justifyContent: "center",
	},
	habit: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		padding: 12,
		borderRadius: t.radii.lg,
		borderWidth: 1.5,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	habitEmoji: {
		width: 44,
		height: 44,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
	},
	groupHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
	groupEmoji: { fontSize: 16, lineHeight: 20 },
	readyHabits: {
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "center",
		gap: 8,
		marginTop: 18,
	},
	readyHabit: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		minHeight: 40,
		maxWidth: "100%",
		paddingLeft: 5,
		paddingRight: 14,
		paddingVertical: 5,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	readyHabitEmoji: {
		width: 28,
		height: 28,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
	},
	readyBadge: {
		width: 96,
		height: 96,
		borderRadius: 48,
		backgroundColor: t.colors.accent,
		alignItems: "center",
		justifyContent: "center",
		marginBottom: 12,
	},
	footer: { paddingHorizontal: 24, paddingTop: 8, gap: 4 },
	haveAccount: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: "center",
		columnGap: 6,
	},
	signIn: { minHeight: 36, justifyContent: "center" },
}));
