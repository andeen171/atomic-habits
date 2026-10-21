import { AiSuggestButton } from "@/components/ai/ai-suggest-button";
import {
	ColorPicker,
	EmojiPicker,
	Field,
	type IdentityChoice,
	IdentityPicker,
	KindSummary,
	KindToggle,
	ScheduleField,
	TemplateIdeas,
	TimeField,
	TimeOfDayField,
	identityTemplateFor,
	newIdentityLook,
} from "@/components/editor/fields";
import { createDraftSetupTasks } from "@/components/editor/setup-shared";
import { SetupTaskAdder } from "@/components/editor/setup-task-adder";
import { SetupTaskToggle } from "@/components/editor/setup-task-toggle";
import { SetupTasksReview } from "@/components/editor/setup-tasks-review";
import { BlueprintCard } from "@/components/habit/blueprint-card";
import { HabitRing } from "@/components/habit/habit-ring";
import { ArrowLeft, ArrowRight, BellRing, Check, X } from "@/components/icons";
import { TrackerField } from "@/components/trackers/tracker-picker";
import { TrackerReviewLine } from "@/components/trackers/tracker-review-line";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Screen } from "@/components/ui/screen";
import { SectionLabel } from "@/components/ui/section-label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SmartTextField } from "@/components/ui/smart-text-field";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { useNotificationPermission } from "@/lib/reminders";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	DEFAULT_HABIT_EMOJI,
	HABIT_COLORS,
	type Habit,
	type HabitColor,
	type HabitKind,
	type HabitTemplate,
	type Identity,
	type Schedule,
	type SetupTaskDraft,
	type TimeOfDay,
	type TrackerConfigInput,
	autoHabitEmoji,
	blueprintLines,
	habitTemplates,
	identityTemplates,
	knownTracker,
	pruneSetupDrafts,
	scheduleLabel,
} from "@atomic/core";
import {
	useActions,
	useAtomic,
	useHabit,
	useIdentities,
	useText,
	useToday,
} from "@atomic/core/react";
import { router, useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform, type ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeInRight, LinearTransition } from "react-native-reanimated";

interface Draft {
	kind: HabitKind;
	name: string;
	/**
	 * The icon. The rendered draft always holds the resolved one (`withLook`):
	 * while `emojiAuto`, the identity's emoji or the kind default (🌱 / 🚫).
	 */
	emoji: string;
	/** Resolved like `emoji`: while `colorAuto`, the identity's color (else the template's, else the kind's). */
	color: HabitColor;
	/** The icon follows the identity (or the kind default) until the user picks one (D12). */
	emojiAuto: boolean;
	/** The color follows the identity until the user picks one. Draft only: never stored. */
	colorAuto: boolean;
	/**
	 * The template applied last. Its emoji is offered as a one-tap "Use 📖"
	 * chip and never replaces an auto icon on its own (D12).
	 */
	template: { key: string; emoji: string; color: HabitColor } | null;
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
	/** How it is logged (Annex K): null = simple check-off. Saved by T1/T4. */
	tracker: TrackerConfigInput | null;
	/** Setup tasks to create on save (Annex T §5.4). Saved by T1/T2. */
	setupTasks: SetupTaskDraft[];
}

/** Identity first (Annex H §1.2): "The goal is not to read a book, it's to become a reader." */
type StepKey = "identity" | "what" | "obvious" | "easy" | "satisfying" | "review";
const STEPS: StepKey[] = ["identity", "what", "obvious", "easy", "satisfying", "review"];
const WHAT_STEP = STEPS.indexOf("what");

/** Break habits' color when nothing else gives one (build habits rotate through the palette). */
const BREAK_COLOR: HabitColor = "rose";

function fromHabit(habit: Habit): Draft {
	return {
		kind: habit.kind,
		name: habit.name,
		emoji: habit.emoji,
		color: habit.color,
		// Legacy "✨" habits arrive here already upgraded to auto (spec §2.3, D12).
		emojiAuto: habit.emojiAuto === true,
		// An existing habit keeps its color when its identity changes.
		colorAuto: false,
		template: null,
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
		tracker: knownTracker(habit),
		setupTasks: [],
	};
}

/**
 * Apply a template while keeping the chosen identity, the icon and color
 * choices and the setup task drafts (spec §5.4, amends Annex H): an auto
 * icon stays the identity's, and the template's emoji is offered as a chip.
 */
function applyTemplate(draft: Draft, template: HabitTemplate): Draft {
	return {
		...draft,
		kind: template.kind,
		name: template.name,
		template: { key: template.key, emoji: template.emoji, color: template.color },
		setupTasks:
			template.kind === draft.kind
				? draft.setupTasks
				: pruneSetupDrafts(draft.setupTasks, template.kind),
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
		tracker: template.tracker,
	};
}

/** The identity a draft links (or will create on save), as far as its look goes. */
interface DraftIdentity {
	statement: string;
	emoji: string;
	color: HabitColor | null;
	/** The stored identity; absent for one the save will create. */
	identity?: Identity;
}

function draftIdentity(draft: Draft, identities: readonly Identity[]): DraftIdentity | null {
	const choice = draft.identity;
	if (choice.mode === "new") return newIdentityLook(choice);
	if (choice.mode === "none") return null;
	const identity = identities.find((item) => item.id === choice.id);
	return identity
		? { statement: identity.statement, emoji: identity.emoji, color: identity.color, identity }
		: null;
}

interface DraftLook {
	emoji: string;
	color: HabitColor;
	/** The icon auto gives: the identity's emoji (break habits too), else 🌱 / 🚫. */
	autoEmoji: string;
	/** Where the auto icon comes from, for the picker's caption and reset. */
	source: "identity" | "default";
}

/**
 * The icon and color the habit gets, following `emojiAuto` / `colorAuto`
 * (Annex H §1.2). Auto color: the identity's, else the applied template's,
 * else the rotating palette color for build habits (spec §6) or rose.
 */
function resolveLook(
	draft: Draft,
	identities: readonly Identity[],
	buildColor: HabitColor,
): DraftLook {
	const identity = draftIdentity(draft, identities);
	const autoEmoji = autoHabitEmoji(draft.kind, identity?.emoji);
	const autoColor =
		identity?.color ?? draft.template?.color ?? (draft.kind === "break" ? BREAK_COLOR : buildColor);
	return {
		emoji: draft.emojiAuto ? autoEmoji : draft.emoji || autoEmoji,
		color: draft.colorAuto ? autoColor : draft.color,
		autoEmoji,
		source: identity ? "identity" : "default",
	};
}

const nul = (value: string) => (value.trim() ? value.trim() : null);

/**
 * The habit input the store receives (pass the resolved draft). An auto icon
 * is sent resolved, and the store derives it again from the saved identity.
 */
function toInput(draft: Draft) {
	const isBreak = draft.kind === "break";
	return {
		kind: draft.kind,
		name: draft.name.trim(),
		emoji: draft.emoji || DEFAULT_HABIT_EMOJI[draft.kind],
		emojiAuto: draft.emojiAuto,
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
		// Sent only when set: an absent key leaves the habit's tracker (known or foreign) as it is.
		...(draft.tracker ? { tracker: draft.tracker } : {}),
	};
}

export default function HabitEditorScreen() {
	const t = useT();
	const text = useText();
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
	const allHabits = useAtomic((s) => s.data.habits);
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const scroll = useRef<ScrollView>(null);
	const templates = useMemo(() => habitTemplates(t.locale), [t.locale]);
	const isEdit = Boolean(existing);
	const { permission, request: requestNotifications } = useNotificationPermission();
	// The rotating palette color, kept for build habits with no identity (spec §6); fixed for this visit.
	const [buildColor] = useState<HabitColor>(
		() => HABIT_COLORS[habitCount % HABIT_COLORS.length] ?? "ember",
	);
	// Only a live identity: a stale link starts at the identity step instead (Annex H §1.2).
	const [linkedFromRoute] = useState(() =>
		!existing && identities.some((identity) => identity.id === params.identityId)
			? (params.identityId ?? null)
			: null,
	);

	const [rawDraft, setDraft] = useState<Draft>(() => {
		if (existing) return fromHabit(existing);
		const kind: HabitKind = params.kind === "break" ? "break" : "build";
		const base: Draft = {
			kind,
			name: params.name ?? "",
			emoji: DEFAULT_HABIT_EMOJI[kind],
			color: kind === "break" ? BREAK_COLOR : buildColor,
			emojiAuto: true,
			colorAuto: true,
			template: null,
			identity: linkedFromRoute ? { mode: "existing", id: linkedFromRoute } : { mode: "none" },
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
			tracker: null,
			setupTasks: [],
		};
		const template = templates.find((tpl) => tpl.key === params.template);
		return template ? applyTemplate(base, template) : base;
	});
	// The icon and color follow the identity while auto (D12), including one edited elsewhere meanwhile.
	const look = useMemo(
		() => resolveLook(rawDraft, identities, buildColor),
		[rawDraft, identities, buildColor],
	);
	const draft = useMemo<Draft>(
		() =>
			look.emoji === rawDraft.emoji && look.color === rawDraft.color
				? rawDraft
				: { ...rawDraft, emoji: look.emoji, color: look.color },
		[rawDraft, look],
	);
	const [mode, setMode] = useState<"guided" | "quick">(isEdit ? "quick" : "guided");
	// Coming from an identity, its choice is made: start at "what" (Annex H §1.2).
	const [step, setStep] = useState(linkedFromRoute ? WHAT_STEP : 0);
	const [nameError, setNameError] = useState<string | null>(null);

	const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
		setDraft((d) => ({ ...d, [key]: value }));
		if (key === "name") setNameError(null);
	};
	/** Merges a patch (the tracker and setup-task components edit the draft through it). */
	const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
	const habitId = existing?.id ?? null;
	/** The user's other build habits: candidate anchors for habit stacking (Annex C §1.6). */
	const stackAnchors = useMemo(
		() =>
			Object.values(allHabits)
				.filter((h) => !h.deletedAt && !h.archivedAt && h.kind === "build" && h.id !== habitId)
				.map((h) => h.name.slice(0, 80))
				.slice(0, 10),
		[allHabits, habitId],
	);

	const isBreak = draft.kind === "break";
	const linked = draftIdentity(draft, identities);
	const identityStatement = linked
		? linked.identity
			? text.identity(linked.identity, "statement")
			: linked.statement
		: null;
	/** The linked identity as the review and preview show it. */
	const identity: Identity | undefined = linked
		? {
				id: linked.identity?.id ?? "new",
				order: 0,
				lang: null,
				createdAt: 0,
				updatedAt: 0,
				deletedAt: null,
				...linked.identity,
				statement: identityStatement ?? linked.statement,
				emoji: linked.emoji,
				color: linked.color ?? draft.color,
			}
		: undefined;

	// Templates of the kind: the matched identity's first ("Ideas for …"), then the rest.
	const matchedKey = linked ? (identityTemplateFor(linked)?.key ?? null) : null;
	const { ideas, rest } = useMemo(() => {
		const ofKind = templates.filter((tpl) => tpl.kind === draft.kind);
		const matched = matchedKey
			? identityTemplates(t.locale).find((tpl) => tpl.key === matchedKey)
			: undefined;
		const keys = new Set(
			matched?.habits.filter((tpl) => tpl.kind === draft.kind).map((tpl) => tpl.key),
		);
		return {
			ideas: ofKind.filter((tpl) => keys.has(tpl.key)),
			rest: ofKind.filter((tpl) => !keys.has(tpl.key)),
		};
	}, [templates, t.locale, draft.kind, matchedKey]);

	const preview: Habit = useMemo(() => {
		const { tracker: _tracker, ...input } = toInput(draft);
		return {
			...(existing ?? {
				id: "preview",
				createdAt: 0,
				updatedAt: 0,
				deletedAt: null,
				identityId: null,
				startDate: today,
				archivedAt: null,
				order: 0,
				goalHistory: [],
				levelUp: null,
				tracker: null,
				lang: null,
			}),
			...input,
			name: draft.name.trim() || t.x("editor.previewEmpty"),
		};
	}, [draft, existing, today, t]);

	const save = () => {
		if (!draft.name.trim()) {
			setNameError(t.t("form.nameRequired"));
			haptics.warning();
			if (mode === "guided") setStep(WHAT_STEP);
			scroll.current?.scrollTo({ y: 0, animated: true });
			return;
		}
		// 1. The new identity, with the icon and color it was given (a chip, the sheet, a match).
		let identityId: string | null = linked?.identity?.id ?? null;
		if (draft.identity.mode === "new" && linked) {
			identityId = actions.createIdentity({
				statement: linked.statement,
				emoji: linked.emoji,
				color: linked.color ?? draft.color,
			}).id;
		}
		// 2. The habit; an auto icon is derived again from the saved identity by the store.
		const input = { ...toInput(draft), identityId };
		let savedId: string;
		if (existing) {
			actions.updateHabit(existing.id, input);
			savedId = existing.id;
		} else {
			savedId = actions.createHabit(input).id;
		}
		// 3. Setup tasks drafted with the habit (Annex T §4.4). 4. The retitle offer (edit mode)
		// comes from the setup-task pieces (`useSetupRetitleOnSave`). 5. Toasts.
		const created = createDraftSetupTasks(actions, savedId, draft);
		const headline = existing ? t.t("common.saved") : t.x("editor.created", { habit: input.name });
		showToast(created ? `${headline}\n${t.tp("setup.created", created)}` : headline, {
			tone: "success",
		});
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

	const stepKey = STEPS[step] ?? "identity";
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
	const pickTemplate = (template: HabitTemplate) => {
		setDraft((d) => applyTemplate(d, template));
		setNameError(null);
	};
	const changeKind = (kind: HabitKind) => {
		if (kind === rawDraft.kind) return;
		// Auto icon and color follow the kind (🌱 / 🚫); the other kind's template doesn't apply.
		setDraft((d) => ({
			...d,
			kind,
			template: null,
			setupTasks: pruneSetupDrafts(d.setupTasks, kind),
		}));
	};
	// The applied template's emoji, offered while the habit wears another icon (D12).
	const offerEmoji =
		draft.template?.emoji && draft.template.emoji !== draft.emoji ? draft.template.emoji : null;

	// ── Sections ──────────────────────────────────────────────
	const identitySection = (
		<View style={styles.section}>
			<IdentityPicker
				identities={identities}
				value={draft.identity}
				onChange={(choice) => set("identity", choice)}
			/>
		</View>
	);

	const whatSection = (
		<View style={styles.section}>
			{isEdit ? (
				<Field label={t.t("form.kind")} hint={t.x("editor.kindLocked")}>
					<KindSummary value={draft.kind} />
				</Field>
			) : (
				<Field label={t.t("form.kind")}>
					<KindToggle value={draft.kind} onChange={changeKind} />
				</Field>
			)}
			<SmartTextField
				field="habit.name"
				label={t.t("form.name")}
				right={
					<AiSuggestButton
						kind="habit.name"
						label={t.t("form.name")}
						input={() => ({
							partial: draft.name.trim().slice(0, 80) || undefined,
							identity: linked?.statement.slice(0, 120),
							kind: draft.kind,
						})}
						onPick={(name) => set("name", name)}
					/>
				}
				value={draft.name}
				onChangeText={(name) => set("name", name)}
				placeholder={isBreak ? t.t("form.namePlaceholderBreak") : t.t("form.namePlaceholder")}
				error={nameError}
				maxLength={120}
				size="lg"
				returnKeyType={mode === "guided" ? "next" : "done"}
				onSubmitEditing={mode === "guided" ? next : undefined}
				testID="editor-name"
			/>
			<Field label={t.t("form.emoji")}>
				<EmojiPicker
					value={draft.emoji}
					onChange={(emoji) => update({ emoji, emojiAuto: false })}
					auto={{
						on: draft.emojiAuto,
						source: look.source,
						emoji: look.autoEmoji,
						onReset: () => update({ emojiAuto: true }),
					}}
					offer={
						offerEmoji
							? { emoji: offerEmoji, onUse: () => update({ emoji: offerEmoji, emojiAuto: false }) }
							: null
					}
				/>
			</Field>
			<Field label={t.t("form.color")}>
				<ColorPicker
					value={draft.color}
					onChange={(color) => update({ color, colorAuto: false })}
				/>
			</Field>
		</View>
	);

	const templatesSection = isEdit ? null : (
		<TemplateIdeas
			ideas={ideas}
			rest={rest}
			identity={matchedKey ? identityStatement : null}
			selectedKey={draft.template?.key ?? null}
			onPick={pickTemplate}
		/>
	);

	/** "Fill the four laws" (AI, Beta): written only into the fields that are still empty (spec §5.4). */
	const fillLaws = (
		<AiSuggestButton
			kind="habit.laws"
			label={t.t("form.fillLaws")}
			disabled={!draft.name.trim()}
			input={() => ({
				habit: draft.name.trim().slice(0, 120),
				kind: draft.kind,
				identity: linked?.statement.slice(0, 120),
			})}
			onPick={(laws) => {
				const patch: Partial<Draft> = {};
				// Break habits get the inverted laws in the same slots.
				if (!draft.environment.trim()) patch.environment = laws.obvious;
				if (!draft.bundle.trim()) patch.bundle = laws.attractive;
				if (!draft.twoMinute.trim()) patch.twoMinute = laws.easy;
				if (!draft.reward.trim()) patch.reward = laws.satisfying;
				if (Object.keys(patch).length) update(patch);
			}}
		/>
	);

	const obviousSection = isBreak ? (
		<View style={styles.section}>
			<SmartTextField
				field="habit.cueLocation"
				label={t.t("form.trigger")}
				value={draft.cueLocation}
				onChangeText={(v) => set("cueLocation", v)}
				placeholder={t.t("form.triggerPlaceholder")}
				maxLength={120}
			/>
			<View style={styles.fieldGroup}>
				<SmartTextField
					field="habit.environment"
					label={t.t("form.invisible")}
					value={draft.environment}
					onChangeText={(v) => set("environment", v)}
					placeholder={t.t("form.invisiblePlaceholder")}
					maxLength={280}
					multiline
				/>
				<SetupTaskToggle field="environment" draft={draft} update={update} habitId={habitId} />
			</View>
			<SetupTaskAdder law={1} draft={draft} update={update} />
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
			<SmartTextField
				field="habit.cueLocation"
				label={t.t("form.cueLocation")}
				right={
					<AiSuggestButton
						kind="habit.intention"
						label={t.t("form.cueLocation")}
						input={() => ({
							habit: draft.name.trim(),
							kind: draft.kind,
							timeOfDay: draft.timeOfDay,
						})}
						onPick={(intention) =>
							update({
								cueLocation: intention.location,
								...(intention.time ? { cueTime: intention.time } : {}),
							})
						}
					/>
				}
				value={draft.cueLocation}
				onChangeText={(v) => set("cueLocation", v)}
				placeholder={t.t("form.cueLocationPlaceholder")}
				maxLength={120}
			/>
			<SmartTextField
				field="habit.stackAfter"
				label={t.t("form.stackAfter")}
				right={
					<AiSuggestButton
						kind="habit.stack"
						label={t.t("form.stackAfter")}
						input={() => ({ habit: draft.name.trim(), anchors: stackAnchors })}
						onPick={(stackAfter) => set("stackAfter", stackAfter)}
					/>
				}
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
			{/* Law 1 includes designing the environment (D13, the book's "Motivation is overrated"). */}
			<View style={styles.fieldGroup}>
				<SmartTextField
					field="habit.environment"
					label={t.t("form.environment")}
					value={draft.environment}
					onChangeText={(v) => set("environment", v)}
					placeholder={t.t("form.environmentPlaceholder")}
					maxLength={280}
					multiline
					testID="editor-environment"
				/>
				<SetupTaskToggle field="environment" draft={draft} update={update} habitId={habitId} />
			</View>
			<SetupTaskAdder law={1} draft={draft} update={update} />
		</View>
	);

	const easySection = isBreak ? (
		<View style={styles.section}>
			<View style={styles.fieldGroup}>
				<SmartTextField
					field="habit.twoMinute"
					label={t.t("form.difficult")}
					value={draft.twoMinute}
					onChangeText={(v) => set("twoMinute", v)}
					placeholder={t.t("form.difficultPlaceholder")}
					maxLength={160}
					multiline
				/>
				<SetupTaskToggle field="twoMinute" draft={draft} update={update} habitId={habitId} />
			</View>
			<TrackerField draft={draft} update={update} />
			<SetupTaskAdder law={3} draft={draft} update={update} />
		</View>
	) : (
		<View style={styles.section}>
			<SmartTextField
				field="habit.twoMinute"
				label={t.t("form.twoMinute")}
				right={
					<AiSuggestButton
						kind="habit.twoMinute"
						label={t.t("form.twoMinute")}
						input={() => ({ habit: draft.name.trim(), kind: draft.kind })}
						onPick={(twoMinute) => set("twoMinute", twoMinute)}
					/>
				}
				value={draft.twoMinute}
				onChangeText={(v) => set("twoMinute", v)}
				placeholder={t.t("form.twoMinutePlaceholder")}
				maxLength={160}
			/>
			<TrackerField draft={draft} update={update} />
			<Field label={t.t("form.target")} hint={t.t("form.targetHint")}>
				<View style={styles.goalRow}>
					<Stepper
						value={draft.target}
						min={1}
						max={10_000}
						onChange={(v) => set("target", v)}
						accessibilityLabel={t.t("form.target")}
					/>
					<SmartTextField
						field="habit.unit"
						value={draft.unit}
						onChangeText={(v) => set("unit", v)}
						placeholder={t.t("form.unitPlaceholder")}
						accessibilityLabel={t.t("form.unit")}
						maxLength={24}
						containerStyle={{ flex: 1 }}
					/>
				</View>
			</Field>
			<SetupTaskAdder law={3} draft={draft} update={update} />
		</View>
	);

	const satisfyingSection = isBreak ? (
		<View style={styles.section}>
			<SmartTextField
				field="habit.bundle"
				label={t.t("form.unattractive")}
				value={draft.bundle}
				onChangeText={(v) => set("bundle", v)}
				placeholder={t.t("form.unattractivePlaceholder")}
				maxLength={160}
				multiline
			/>
			<View style={styles.fieldGroup}>
				<SmartTextField
					field="habit.reward"
					label={t.t("form.unsatisfying")}
					value={draft.reward}
					onChangeText={(v) => set("reward", v)}
					placeholder={t.t("form.unsatisfyingPlaceholder")}
					maxLength={160}
					multiline
				/>
				<SetupTaskToggle field="reward" draft={draft} update={update} habitId={habitId} />
			</View>
			<SetupTaskAdder law={2} draft={draft} update={update} />
			<SetupTaskAdder law={4} draft={draft} update={update} />
		</View>
	) : (
		<View style={styles.section}>
			<SmartTextField
				field="habit.bundle"
				label={t.t("form.bundle")}
				hint={t.t("form.bundleHint")}
				value={draft.bundle}
				onChangeText={(v) => set("bundle", v)}
				placeholder={t.t("form.bundlePlaceholder")}
				maxLength={160}
			/>
			<SmartTextField
				field="habit.reward"
				label={t.t("form.reward")}
				hint={t.t("form.rewardHint")}
				value={draft.reward}
				onChangeText={(v) => set("reward", v)}
				placeholder={t.t("form.rewardPlaceholder")}
				maxLength={160}
			/>
			<SmartTextField
				field="habit.why"
				label={t.t("form.why")}
				value={draft.why}
				onChangeText={(v) => set("why", v)}
				placeholder={t.t("form.whyPlaceholder")}
				maxLength={280}
				multiline
			/>
			<SetupTaskAdder law={2} draft={draft} update={update} />
			<SetupTaskAdder law={4} draft={draft} update={update} />
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
			<TrackerReviewLine draft={draft} />
			<SetupTasksReview draft={draft} update={update} habitId={habitId} />
		</View>
	);

	const stepMeta: Record<
		StepKey,
		{ title: string; hint?: string; action?: ReactNode; body: ReactNode }
	> = {
		identity: {
			title: t.t("form.step.identity"),
			hint: t.t("form.step.identityHint"),
			body: identitySection,
		},
		what: {
			title: isBreak ? t.t("form.step.whatBreak") : t.t("form.step.what"),
			body: (
				<View style={{ gap: 28 }}>
					{whatSection}
					{templatesSection}
				</View>
			),
		},
		obvious: {
			...(isBreak
				? { title: t.t("form.step.invisible"), hint: t.t("form.step.invisibleHint") }
				: { title: t.t("form.step.obvious"), hint: t.t("form.step.obviousHint") }),
			action: fillLaws,
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

	// Screen readers hear the new step: its fields replaced the ones that had focus.
	const announced = useRef(step);
	useEffect(() => {
		if (mode !== "guided" || announced.current === step) return;
		announced.current = step;
		AccessibilityInfo.announceForAccessibility(
			`${t.t("form.step", { current: step + 1, total: STEPS.length })}. ${current.title}`,
		);
	}, [step, mode, current.title, t]);

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
						testID="editor-back"
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
						<Text variant="display" accessibilityRole="header" testID="editor-step-title">
							{current.title}
						</Text>
						{current.hint || current.action ? (
							<View style={styles.hintRow}>
								<Text tone="muted" style={{ flex: 1 }}>
									{current.hint}
								</Text>
								{current.action}
							</View>
						) : null}
					</View>
					{current.body}
				</Animated.View>
			) : (
				<Animated.View
					entering={reduceMotion ? undefined : FadeIn.duration(200)}
					style={{ gap: 32 }}
				>
					<View>
						<SectionLabel>{t.t("form.identity")}</SectionLabel>
						<Text variant="small" tone="muted" style={styles.quickHint}>
							{t.t("form.step.identity")}
						</Text>
						{identitySection}
					</View>
					<View>
						<SectionLabel>
							{isBreak ? t.t("form.step.whatBreak") : t.t("form.step.what")}
						</SectionLabel>
						{whatSection}
					</View>
					<View style={{ gap: 28 }}>
						<View>
							<SectionLabel right={fillLaws}>{t.t("form.advanced")}</SectionLabel>
							<Text variant="small" tone="muted" style={[styles.quickHint, { marginBottom: 0 }]}>
								{t.t("form.advancedHint")}
							</Text>
						</View>
						<LawBlock law="1" title={t.t(isBreak ? "form.step.invisible" : "form.step.obvious")}>
							{obviousSection}
						</LawBlock>
						<LawBlock law="3" title={t.t(isBreak ? "form.step.difficult" : "form.step.easy")}>
							{easySection}
						</LawBlock>
						<LawBlock
							law="2 · 4"
							title={t.t(isBreak ? "form.step.unsatisfying" : "form.step.satisfying")}
						>
							{satisfyingSection}
						</LawBlock>
					</View>
					<SetupTasksReview draft={draft} update={update} habitId={habitId} />
					{templatesSection}
				</Animated.View>
			)}
		</Screen>
	);
}

/** A law's numbered header in quick mode. */
function LawBlock({ law, title, children }: { law: string; title: string; children: ReactNode }) {
	const styles = useStyles();
	return (
		<View>
			<View style={styles.lawHeader}>
				<View style={styles.lawBadge}>
					<Text variant="tiny" weight="bold" tabular>
						{law}
					</Text>
				</View>
				<Text variant="h3" accessibilityRole="header" style={{ flex: 1 }}>
					{title}
				</Text>
			</View>
			{children}
		</View>
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
	fieldGroup: { gap: 8 },
	hintRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
	quickHint: { marginTop: -4, marginBottom: 14 },
	lawHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
	lawBadge: {
		minWidth: 26,
		height: 26,
		paddingHorizontal: 7,
		borderRadius: 13,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.accentSoft,
	},
	reminder: { flexDirection: "row", alignItems: "center", gap: 12 },
	allow: { alignSelf: "flex-start", marginTop: 8 },
	goalRow: { flexDirection: "row", alignItems: "center", gap: 14 },
	footerRow: { flexDirection: "row", gap: 10 },
}));
