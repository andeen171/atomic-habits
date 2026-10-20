import {
	ColorPicker,
	EmojiPicker,
	Field,
	type IdentityChoice,
	IdentityPicker,
	KindSummary,
	KindToggle,
	ScheduleField,
	TemplatePicker,
	TimeField,
	TimeOfDayField,
} from "@/components/editor/fields";
import { BlueprintCard } from "@/components/habit/blueprint-card";
import { HabitRing } from "@/components/habit/habit-ring";
import { ArrowLeft, ArrowRight, BellRing, Check, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Screen } from "@/components/ui/screen";
import { SectionLabel } from "@/components/ui/section-label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { useNotificationPermission } from "@/lib/reminders";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	HABIT_COLORS,
	type Habit,
	type HabitColor,
	type HabitKind,
	type HabitTemplate,
	type Schedule,
	type TimeOfDay,
	blueprintLines,
	habitTemplates,
	scheduleLabel,
} from "@atomic/core";
import { useActions, useAtomic, useHabit, useIdentities, useToday } from "@atomic/core/react";
import { router, useLocalSearchParams } from "expo-router";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Platform, type ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeInRight, LinearTransition } from "react-native-reanimated";

interface Draft {
	kind: HabitKind;
	name: string;
	emoji: string;
	color: HabitColor;
	identity: IdentityChoice;
	schedule: Schedule;
	timeOfDay: TimeOfDay;
	cueTime: string | null;
	cueLocation: string;
	stackAfter: string;
	reminder: boolean;
	twoMinute: string;
	target: number;
	unit: string;
	bundle: string;
	reward: string;
	why: string;
	environment: string;
}

type StepKey = "what" | "identity" | "obvious" | "easy" | "satisfying" | "review";
const STEPS: StepKey[] = ["what", "identity", "obvious", "easy", "satisfying", "review"];

function fromHabit(habit: Habit): Draft {
	return {
		kind: habit.kind,
		name: habit.name,
		emoji: habit.emoji,
		color: habit.color,
		identity: habit.identityId ? { mode: "existing", id: habit.identityId } : { mode: "none" },
		schedule: habit.schedule,
		timeOfDay: habit.timeOfDay,
		cueTime: habit.cueTime,
		cueLocation: habit.cueLocation ?? "",
		stackAfter: habit.stackAfter ?? "",
		reminder: habit.reminder,
		twoMinute: habit.twoMinute ?? "",
		target: habit.target,
		unit: habit.unit ?? "",
		bundle: habit.bundle ?? "",
		reward: habit.reward ?? "",
		why: habit.why ?? "",
		environment: habit.environment ?? "",
	};
}

function applyTemplate(draft: Draft, template: HabitTemplate): Draft {
	return {
		...draft,
		kind: template.kind,
		name: template.name,
		emoji: template.emoji,
		color: template.color,
		schedule: template.schedule,
		timeOfDay: template.timeOfDay,
		cueTime: template.cueTime,
		cueLocation: template.cueLocation ?? "",
		stackAfter: template.stackAfter ?? "",
		twoMinute: template.twoMinute ?? "",
		target: template.target,
		unit: template.unit ?? "",
		bundle: template.bundle ?? "",
		reward: template.reward ?? "",
		environment: template.environment ?? "",
	};
}

const nul = (value: string) => (value.trim() ? value.trim() : null);

/** The habit input the store receives (and the preview renders). */
function toInput(draft: Draft) {
	const isBreak = draft.kind === "break";
	return {
		kind: draft.kind,
		name: draft.name.trim(),
		emoji: draft.emoji,
		color: draft.color,
		schedule: isBreak ? ({ type: "daily" } as Schedule) : draft.schedule,
		timeOfDay: draft.timeOfDay,
		cueTime: isBreak ? null : draft.cueTime,
		cueLocation: nul(draft.cueLocation),
		stackAfter: nul(draft.stackAfter),
		reminder: !isBreak && draft.reminder && Boolean(draft.cueTime),
		twoMinute: nul(draft.twoMinute),
		target: isBreak ? 1 : draft.target,
		unit: isBreak ? null : nul(draft.unit),
		bundle: nul(draft.bundle),
		reward: nul(draft.reward),
		why: isBreak ? null : nul(draft.why),
		environment: nul(draft.environment),
	};
}

export default function HabitEditorScreen() {
	const t = useT();
	const params = useLocalSearchParams<{
		id?: string;
		template?: string;
		kind?: string;
		name?: string;
		identityId?: string;
	}>();
	const existing = useHabit(params.id);
	const actions = useActions();
	const identities = useIdentities();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const habitCount = useAtomic((s) => Object.keys(s.data.habits).length);
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const scroll = useRef<ScrollView>(null);
	const templates = useMemo(() => habitTemplates(t.locale), [t.locale]);
	const isEdit = Boolean(existing);
	const { permission, request: requestNotifications } = useNotificationPermission();

	const [draft, setDraft] = useState<Draft>(() => {
		if (existing) return fromHabit(existing);
		const base: Draft = {
			kind: params.kind === "break" ? "break" : "build",
			name: params.name ?? "",
			emoji: params.kind === "break" ? "📵" : "✨",
			color: HABIT_COLORS[habitCount % HABIT_COLORS.length] ?? "ember",
			identity: params.identityId ? { mode: "existing", id: params.identityId } : { mode: "none" },
			schedule: { type: "daily" },
			timeOfDay: "anytime",
			cueTime: null,
			cueLocation: "",
			stackAfter: "",
			reminder: false,
			twoMinute: "",
			target: 1,
			unit: "",
			bundle: "",
			reward: "",
			why: "",
			environment: "",
		};
		const template = templates.find((tpl) => tpl.key === params.template);
		return template ? applyTemplate(base, template) : base;
	});
	const [mode, setMode] = useState<"guided" | "quick">(isEdit ? "quick" : "guided");
	const [step, setStep] = useState(0);
	const [nameError, setNameError] = useState<string | null>(null);

	const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
		setDraft((d) => ({ ...d, [key]: value }));
		if (key === "name") setNameError(null);
	};

	const isBreak = draft.kind === "break";
	const identity =
		draft.identity.mode === "existing"
			? identities.find((i) => i.id === (draft.identity as { id: string }).id)
			: draft.identity.mode === "new" && draft.identity.statement.trim()
				? {
						id: "new",
						statement: draft.identity.statement.trim(),
						emoji: "🌱",
						color: draft.color,
						order: 0,
						lang: null,
						createdAt: 0,
						updatedAt: 0,
						deletedAt: null,
					}
				: undefined;

	const preview: Habit = useMemo(
		() => ({
			...(existing ?? {
				id: "preview",
				createdAt: 0,
				updatedAt: 0,
				deletedAt: null,
				identityId: null,
				startDate: today,
				archivedAt: null,
				order: 0,
				emojiAuto: false,
				goalHistory: [],
				levelUp: null,
				tracker: null,
				lang: null,
			}),
			...toInput(draft),
			name: draft.name.trim() || t.x("editor.previewEmpty"),
		}),
		[draft, existing, today, t],
	);

	const save = () => {
		if (!draft.name.trim()) {
			setNameError(t.t("form.nameRequired"));
			haptics.warning();
			if (mode === "guided") setStep(0);
			scroll.current?.scrollTo({ y: 0, animated: true });
			return;
		}
		let identityId: string | null = null;
		if (draft.identity.mode === "existing") identityId = draft.identity.id;
		if (draft.identity.mode === "new" && draft.identity.statement.trim()) {
			// No emoji: the identity gets the 🌱 default the review step previews.
			identityId = actions.createIdentity({
				statement: draft.identity.statement.trim(),
				color: draft.color,
			}).id;
		}
		const input = { ...toInput(draft), identityId };
		if (existing) {
			actions.updateHabit(existing.id, input);
			showToast(t.t("common.saved"), { tone: "success" });
		} else {
			actions.createHabit(input);
			showToast(t.x("editor.created", { habit: input.name }), { tone: "success" });
		}
		haptics.success();
		router.canGoBack() ? router.back() : router.replace("/");
	};

	const toggleReminder = async (value: boolean) => {
		if (!value) {
			set("reminder", false);
			return;
		}
		if (Platform.OS !== "web") {
			const granted = await requestNotifications();
			if (!granted) {
				showToast(t.t("settings.remindersDenied"), { tone: "danger" });
				return;
			}
		}
		set("reminder", true);
	};

	const stepKey = STEPS[step] ?? "what";
	const goTo = (next: number) => {
		haptics.selection();
		setStep(next);
		scroll.current?.scrollTo({ y: 0, animated: false });
	};
	const next = () => {
		if (stepKey === "what" && !draft.name.trim()) {
			setNameError(t.t("form.nameRequired"));
			haptics.warning();
			return;
		}
		if (step === STEPS.length - 1) save();
		else goTo(step + 1);
	};

	// ── Sections ──────────────────────────────────────────────
	const whatSection = (
		<View style={styles.section}>
			{isEdit ? (
				<Field label={t.t("form.kind")} hint={t.x("editor.kindLocked")}>
					<KindSummary value={draft.kind} />
				</Field>
			) : (
				<Field label={t.t("form.kind")}>
					<KindToggle value={draft.kind} onChange={(kind) => set("kind", kind)} />
				</Field>
			)}
			<TextField
				label={t.t("form.name")}
				value={draft.name}
				onChangeText={(name) => set("name", name)}
				placeholder={isBreak ? t.t("form.namePlaceholderBreak") : t.t("form.namePlaceholder")}
				error={nameError}
				maxLength={120}
				size="lg"
				testID="editor-name"
			/>
			<Field label={t.t("form.emoji")}>
				<EmojiPicker value={draft.emoji} onChange={(emoji) => set("emoji", emoji)} />
			</Field>
			<Field label={t.t("form.color")}>
				<ColorPicker value={draft.color} onChange={(color) => set("color", color)} />
			</Field>
			{isEdit ? null : (
				<Field label={t.t("form.templates")} hint={t.t("form.templatesHint")}>
					<TemplatePicker
						templates={templates.filter((tpl) => tpl.kind === draft.kind)}
						onPick={(template) => {
							setDraft((d) => applyTemplate(d, template));
							setNameError(null);
						}}
					/>
				</Field>
			)}
		</View>
	);

	const identitySection = (
		<View style={styles.section}>
			<IdentityPicker
				identities={identities}
				value={draft.identity}
				onChange={(choice) => set("identity", choice)}
			/>
		</View>
	);

	const obviousSection = isBreak ? (
		<View style={styles.section}>
			<TextField
				label={t.t("form.trigger")}
				value={draft.cueLocation}
				onChangeText={(v) => set("cueLocation", v)}
				placeholder={t.t("form.triggerPlaceholder")}
				maxLength={120}
			/>
			<TextField
				label={t.t("form.invisible")}
				value={draft.environment}
				onChangeText={(v) => set("environment", v)}
				placeholder={t.t("form.invisiblePlaceholder")}
				maxLength={280}
				multiline
			/>
		</View>
	) : (
		<View style={styles.section}>
			<Field label={t.t("form.schedule")}>
				<ScheduleField value={draft.schedule} onChange={(schedule) => set("schedule", schedule)} />
			</Field>
			<Field label={t.t("form.timeOfDay")}>
				<TimeOfDayField value={draft.timeOfDay} onChange={(v) => set("timeOfDay", v)} />
			</Field>
			<Field label={t.t("form.cueTime")}>
				<TimeField
					value={draft.cueTime}
					onChange={(v) =>
						setDraft((d) => ({ ...d, cueTime: v, reminder: v ? d.reminder : false }))
					}
				/>
			</Field>
			<TextField
				label={t.t("form.cueLocation")}
				value={draft.cueLocation}
				onChangeText={(v) => set("cueLocation", v)}
				placeholder={t.t("form.cueLocationPlaceholder")}
				maxLength={120}
			/>
			<TextField
				label={t.t("form.stackAfter")}
				hint={t.t("form.stackAfterHint")}
				prefix={t.t("form.stackAfterPrefix")}
				value={draft.stackAfter}
				onChangeText={(v) => set("stackAfter", v)}
				placeholder={t.t("form.stackAfterPlaceholder")}
				maxLength={160}
			/>
			{Platform.OS === "web" ? null : (
				<Card tone="sunken" padding={14} style={styles.reminder}>
					<View style={{ flex: 1, gap: 2 }}>
						<Text weight="semibold">{t.t("form.reminder")}</Text>
						<Text variant="small" tone="muted">
							{draft.cueTime ? t.t("form.reminderHint") : t.t("form.reminderNeedsTime")}
						</Text>
						{/* An imported or synced reminder can be on without the permission to deliver it. */}
						{draft.reminder && draft.cueTime && permission?.granted === false ? (
							<Button
								label={t.x("settings.remindersEnable")}
								icon={BellRing}
								variant="secondary"
								size="sm"
								onPress={() => void requestNotifications()}
								style={styles.allow}
								testID="editor-allow-notifications"
							/>
						) : null}
					</View>
					<Switch
						value={draft.reminder && Boolean(draft.cueTime)}
						disabled={!draft.cueTime}
						onValueChange={(v) => void toggleReminder(v)}
						accessibilityLabel={t.t("form.reminder")}
					/>
				</Card>
			)}
		</View>
	);

	const easySection = isBreak ? (
		<View style={styles.section}>
			<TextField
				label={t.t("form.difficult")}
				value={draft.twoMinute}
				onChangeText={(v) => set("twoMinute", v)}
				placeholder={t.t("form.difficultPlaceholder")}
				maxLength={160}
				multiline
			/>
		</View>
	) : (
		<View style={styles.section}>
			<TextField
				label={t.t("form.twoMinute")}
				value={draft.twoMinute}
				onChangeText={(v) => set("twoMinute", v)}
				placeholder={t.t("form.twoMinutePlaceholder")}
				maxLength={160}
			/>
			<Field label={t.t("form.target")} hint={t.t("form.targetHint")}>
				<View style={styles.goalRow}>
					<Stepper
						value={draft.target}
						min={1}
						max={10_000}
						onChange={(v) => set("target", v)}
						accessibilityLabel={t.t("form.target")}
					/>
					<TextField
						value={draft.unit}
						onChangeText={(v) => set("unit", v)}
						placeholder={t.t("form.unitPlaceholder")}
						accessibilityLabel={t.t("form.unit")}
						maxLength={24}
						containerStyle={{ flex: 1 }}
					/>
				</View>
			</Field>
		</View>
	);

	const satisfyingSection = isBreak ? (
		<View style={styles.section}>
			<TextField
				label={t.t("form.unattractive")}
				value={draft.bundle}
				onChangeText={(v) => set("bundle", v)}
				placeholder={t.t("form.unattractivePlaceholder")}
				maxLength={160}
				multiline
			/>
			<TextField
				label={t.t("form.unsatisfying")}
				value={draft.reward}
				onChangeText={(v) => set("reward", v)}
				placeholder={t.t("form.unsatisfyingPlaceholder")}
				maxLength={160}
				multiline
			/>
		</View>
	) : (
		<View style={styles.section}>
			<TextField
				label={t.t("form.bundle")}
				hint={t.t("form.bundleHint")}
				value={draft.bundle}
				onChangeText={(v) => set("bundle", v)}
				placeholder={t.t("form.bundlePlaceholder")}
				maxLength={160}
			/>
			<TextField
				label={t.t("form.reward")}
				hint={t.t("form.rewardHint")}
				value={draft.reward}
				onChangeText={(v) => set("reward", v)}
				placeholder={t.t("form.rewardPlaceholder")}
				maxLength={160}
			/>
			<TextField
				label={t.t("form.why")}
				value={draft.why}
				onChangeText={(v) => set("why", v)}
				placeholder={t.t("form.whyPlaceholder")}
				maxLength={280}
				multiline
			/>
			<TextField
				label={t.t("form.environment")}
				value={draft.environment}
				onChangeText={(v) => set("environment", v)}
				placeholder={t.t("form.environmentPlaceholder")}
				maxLength={280}
				multiline
			/>
		</View>
	);

	const reviewSection = (
		<View style={styles.section}>
			<BlueprintCard habit={preview} identity={identity} showHint={false} />
			<Text variant="small" tone="muted">
				{[
					isBreak ? t.t("habits.filter.break") : scheduleLabel(preview, t, weekStartsOn),
					t.t(`time.${draft.timeOfDay}`),
					draft.cueTime,
				]
					.filter(Boolean)
					.join(" · ")}
			</Text>
		</View>
	);

	const stepMeta: Record<StepKey, { title: string; hint?: string; body: ReactNode }> = {
		what: {
			title: isBreak ? t.t("form.step.whatBreak") : t.t("form.step.what"),
			body: whatSection,
		},
		identity: {
			title: t.t("form.step.identity"),
			hint: t.t("form.step.identityHint"),
			body: identitySection,
		},
		obvious: isBreak
			? {
					title: t.t("form.step.invisible"),
					hint: t.t("form.step.invisibleHint"),
					body: obviousSection,
				}
			: {
					title: t.t("form.step.obvious"),
					hint: t.t("form.step.obviousHint"),
					body: obviousSection,
				},
		easy: isBreak
			? {
					title: t.t("form.step.difficult"),
					hint: t.t("form.step.difficultHint"),
					body: easySection,
				}
			: { title: t.t("form.step.easy"), hint: t.t("form.step.easyHint"), body: easySection },
		satisfying: isBreak
			? {
					title: t.t("form.step.unsatisfying"),
					hint: t.t("form.step.unsatisfyingHint"),
					body: satisfyingSection,
				}
			: {
					title: t.t("form.step.satisfying"),
					hint: t.t("form.step.satisfyingHint"),
					body: satisfyingSection,
				},
		review: {
			title: t.t("form.step.review"),
			hint: t.t("form.step.reviewHint"),
			body: reviewSection,
		},
	};
	const current = stepMeta[stepKey];
	const isLast = step === STEPS.length - 1;

	const footer =
		mode === "guided" ? (
			<View style={styles.footerRow}>
				{step > 0 ? (
					<Button
						label={t.t("common.back")}
						icon={ArrowLeft}
						variant="secondary"
						size="lg"
						onPress={() => goTo(step - 1)}
						style={{ flex: 1 }}
					/>
				) : null}
				<Button
					label={
						isLast ? (isEdit ? t.t("form.saveChanges") : t.t("form.create")) : t.t("common.next")
					}
					iconRight={isLast ? Check : ArrowRight}
					size="lg"
					onPress={next}
					style={{ flex: 2 }}
					testID="editor-next"
				/>
			</View>
		) : (
			<Button
				label={isEdit ? t.t("form.saveChanges") : t.t("form.create")}
				icon={Check}
				size="lg"
				onPress={save}
				testID="editor-save"
			/>
		);

	return (
		<Screen
			back
			onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
			title={isEdit ? t.t("form.editTitle") : t.t("form.newTitle")}
			keyboard
			footer={footer}
			scrollRef={scroll}
			right={
				<IconButton
					icon={X}
					variant="soft"
					size={38}
					accessibilityLabel={t.t("common.cancel")}
					onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
				/>
			}
			testID="habit-editor"
		>
			<Text variant="title" accessibilityRole="header" style={styles.title}>
				{isEdit ? t.t("form.editTitle") : t.t("form.newTitle")}
			</Text>
			<SegmentedControl<"guided" | "quick">
				value={mode}
				onChange={setMode}
				segments={[
					{ value: "guided", label: t.t("form.guided") },
					{ value: "quick", label: t.t("form.quick") },
				]}
				style={styles.mode}
			/>
			<PreviewCard habit={preview} lineFallback={scheduleLabel(preview, t, weekStartsOn)} />

			{mode === "guided" ? (
				<Animated.View
					key={stepKey}
					entering={reduceMotion ? undefined : FadeInRight.duration(220)}
				>
					<View style={styles.stepHeader}>
						<Text variant="label" tone="accent">
							{t.t("form.step", { current: step + 1, total: STEPS.length })}
						</Text>
						<View style={styles.progressTrack}>
							<Animated.View
								layout={LinearTransition}
								style={[styles.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]}
							/>
						</View>
						<Text variant="display" accessibilityRole="header">
							{current.title}
						</Text>
						{current.hint ? <Text tone="muted">{current.hint}</Text> : null}
					</View>
					{current.body}
				</Animated.View>
			) : (
				<Animated.View
					entering={reduceMotion ? undefined : FadeIn.duration(200)}
					style={{ gap: 28 }}
				>
					{whatSection}
					<View>
						<SectionLabel>{t.t("form.identity")}</SectionLabel>
						{identitySection}
					</View>
					<View>
						<SectionLabel>{isBreak ? t.t("law.1.inverse") : t.x("editor.whenWhere")}</SectionLabel>
						{obviousSection}
					</View>
					<View>
						<SectionLabel>{isBreak ? t.t("law.3.inverse") : t.x("editor.goal")}</SectionLabel>
						{easySection}
					</View>
					<View>
						<SectionLabel>{t.t("form.advanced")}</SectionLabel>
						<Text variant="small" tone="muted" style={{ marginBottom: 12, marginTop: -4 }}>
							{t.t("form.advancedHint")}
						</Text>
						{satisfyingSection}
					</View>
				</Animated.View>
			)}
		</Screen>
	);
}

/** Live preview: ring + name + first blueprint sentence. */
function PreviewCard({ habit, lineFallback }: { habit: Habit; lineFallback: string }) {
	const t = useT();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const line =
		blueprintLines(habit, t)[0]?.text ?? (habit.twoMinute ? habit.twoMinute : lineFallback);
	return (
		<Animated.View
			layout={LinearTransition}
			style={[styles.preview, { borderColor: toneOf(habit.color).soft }]}
		>
			<HabitRing
				habit={habit}
				count={0}
				progress={0}
				state="pending"
				size={44}
				disabled
				showVotes={false}
			/>
			<View style={{ flex: 1, gap: 2 }}>
				<Text variant="tiny" weight="semibold" tone="subtle">
					{t.x("editor.preview").toUpperCase()}
				</Text>
				<Text weight="semibold" numberOfLines={1}>
					{habit.name}
				</Text>
				<Text variant="small" tone="muted" numberOfLines={2}>
					{line}
				</Text>
			</View>
		</Animated.View>
	);
}

const useStyles = makeStyles((t) => ({
	title: { marginBottom: 14 },
	mode: { marginBottom: 14 },
	preview: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		padding: 14,
		borderRadius: t.radii.lg,
		borderWidth: 1.5,
		backgroundColor: t.colors.surface,
		marginBottom: 22,
		...t.cardShadow,
	},
	stepHeader: { gap: 8, marginBottom: 20 },
	progressTrack: {
		height: 4,
		borderRadius: 2,
		backgroundColor: t.colors.sunken,
		overflow: "hidden",
		marginBottom: 6,
	},
	progressFill: { height: 4, borderRadius: 2, backgroundColor: t.colors.accent },
	section: { gap: 20 },
	reminder: { flexDirection: "row", alignItems: "center", gap: 12 },
	allow: { alignSelf: "flex-start", marginTop: 8 },
	goalRow: { flexDirection: "row", alignItems: "center", gap: 14 },
	footerRow: { flexDirection: "row", gap: 10 },
}));
