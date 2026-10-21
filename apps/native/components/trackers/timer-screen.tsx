import { displayHabit } from "@/components/habit/display-habit";
import { BellRing, Check, Pause, Play, Plus, RotateCcw, Square, Wind } from "@/components/icons";
import { ConfirmSheet } from "@/components/sheet/confirm-sheet";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { useNotificationPermission } from "@/lib/reminders";
import { fonts, makeStyles, useTheme } from "@/lib/theme";
import { cancelTimerBell, scheduleTimerBell } from "@/lib/timer-notify";
import { canTime, getTimer, timerStore, useTimerState } from "@/lib/timer-store";
import { showToast, ui } from "@/lib/ui-store";
import {
	type DayKey,
	type Habit,
	type TrackerConfig,
	formatTimerClock,
	recentValues,
	timerEntry,
	timerSeconds,
	trackerDayLine,
	trackerEntryIndexOf,
} from "@atomic/core";
import {
	useActions,
	useAtomicStore,
	useHabit,
	useText,
	useTimerView,
	useToday,
	useTracker,
	useTrackerEntryIndex,
} from "@atomic/core/react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
	Easing,
	useAnimatedProps,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { deviceStorage } from "./device-storage";
import { HabitScreen, ScreenNotice, closeHabitScreen } from "./habit-screen";

type SessionConfig = Extract<TrackerConfig, { type: "session" }>;

const LENGTHS = [1, 2, 5, 10, 15, 20, 30, 45, 60];
/** Breathing guide: 4 s in, 6 s out (a calm, longer exhale). */
const BREATH_IN_MS = 4000;
const BREATH_MS = 10_000;
const KEEP_AWAKE_TAG = "atomic-timer";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const announce = (message: string) => AccessibilityInfo.announceForAccessibility(message);

/**
 * The full-screen session timer (Annex K §5.2): a countdown or stopwatch
 * ring in the habit color with mm:ss in the display serif, topic chips, a
 * breathing guide for meditation, Start / Pause / Finish, "Time's up" with a
 * note prompt, Save, Keep going and Discard. The state is wall-clock based
 * and kept on the device (`lib/timer-store.ts`), so it survives an app
 * kill; the bell rings through a local notification in the background
 * (`lib/timer-notify.ts`), and the screen stays awake while it runs. Back
 * leaves it running (Today shows the banner). Owner: T4.
 */
export function TimerScreen({ habitId, day }: { habitId: string; day?: DayKey }) {
	const t = useT();
	const habit = useHabit(habitId);
	const tracker = useTracker(habit);
	const usable = habit && tracker?.active && tracker.config.type === "session" && !habit.archivedAt;
	return (
		<HabitScreen habit={habit} habitId={habitId} keyboard testID="habit-timer">
			{!habit ? (
				<ScreenNotice title={t.t("notFound.title")} body={t.t("notFound.body")} />
			) : !usable ? (
				<ScreenNotice
					title={t.t("tracker.type.session.name")}
					body={habit.archivedAt ? t.t("tracker.archived") : t.t("tracker.readOnly")}
					habitId={habit.id}
				/>
			) : (
				<TimerBody habit={habit} config={tracker.config as SessionConfig} day={day} />
			)}
		</HabitScreen>
	);
}

/** Per device: whether this habit's timer shows the breathing guide. */
function useBreathing(habitId: string, fallback: boolean): [boolean, (on: boolean) => void] {
	const key = `atomic-habits:breathing:${habitId}`;
	const [on, setOn] = useState(() => {
		const saved = deviceStorage.get(key);
		return saved === null ? fallback : saved === "1";
	});
	const set = (next: boolean) => {
		setOn(next);
		deviceStorage.set(key, next ? "1" : "0");
	};
	return [on, set];
}

/** Keeps the screen on while this screen is focused and the timer runs. */
function useKeepAwakeWhile(active: boolean) {
	useFocusEffect(
		useCallback(() => {
			if (!active) return;
			activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
			return () => {
				deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
			};
		}, [active]),
	);
}

function TimerBody({
	habit,
	config,
	day: dayParam,
}: {
	habit: Habit;
	config: SessionConfig;
	day?: DayKey;
}) {
	const t = useT();
	const text = useText();
	const actions = useActions();
	const store = useAtomicStore();
	const today = useToday();
	const index = useTrackerEntryIndex();
	const reduceMotion = useReduceMotion();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const { width } = useWindowDimensions();
	const { permission, request } = useNotificationPermission();
	const timer = useTimerState();
	const mine = timer?.habitId === habit.id ? timer : null;
	const otherTimer = timer && !mine ? timer : null;
	const otherHabit = useHabit(otherTimer?.habitId);
	// Another habit's timer blocks this one only while it can be finished there (a stale
	// one is dropped by the timer watcher); Start is never greyed out without saying why.
	const other = otherTimer && canTime(otherHabit) ? otherTimer : null;
	const view = useTimerView(mine);
	const day = dayParam ?? today;
	const name = text.habit(habit, "name");
	const tone = toneOf(habit.color);
	const [finishing, setFinishing] = useState(false);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const [note, setNote] = useState("");
	const [breathing, setBreathing] = useBreathing(habit.id, config.prompt === "felt");
	const [mode, setMode] = useState<"countdown" | "stopwatch">(
		config.preset ? "countdown" : "stopwatch",
	);
	const [minutes, setMinutes] = useState(config.preset ?? 10);
	const topics = useMemo(() => {
		const recent = recentValues(index, habit.id, "session", "label", 8, today);
		const seen = new Set<string>();
		const out: string[] = [];
		for (const value of [...config.labels, ...recent]) {
			const key = value.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(value);
		}
		return out.slice(0, 12);
	}, [index, habit.id, today, config.labels]);
	const [extraTopics, setExtraTopics] = useState<string[]>([]);
	const [label, setLabel] = useState<string | null>(() => topics[0] ?? null);
	const [topicDraft, setTopicDraft] = useState("");
	const announcedUp = useRef<number | null>(null);

	const running = !!view?.running;
	const timeUp = !!view?.timeUp;
	const showFinish = !!mine && (finishing || timeUp);
	useKeepAwakeWhile(running && !timeUp);

	// Time's up arrives while the screen is open: say so once.
	useEffect(() => {
		if (!timeUp || !mine || announcedUp.current === mine.startedAt) return;
		announcedUp.current = mine.startedAt;
		announce(t.t("tracker.session.timeUp"));
	}, [timeUp, mine, t]);

	const start = () => {
		if (other) return;
		// A stale timer of another habit (its habit gone or no longer timed) gives way.
		if (timer && !mine) {
			void cancelTimerBell(timer.habitId);
			timerStore.clear();
		}
		const preset = mode === "countdown" ? minutes * 60 : null;
		if (timerStore.start(habit.id, day, preset, label)) {
			haptics.medium();
			setFinishing(false);
			setNote("");
			announce(t.t("tracker.session.started"));
		}
	};
	const pause = () => {
		timerStore.pause();
		haptics.light();
		announce(t.t("tracker.session.paused"));
	};
	const resume = () => {
		timerStore.resume();
		haptics.light();
		setFinishing(false);
		announce(t.t("tracker.session.running"));
	};
	const finish = () => {
		if (!mine) return;
		if (running && !timeUp) timerStore.pause();
		haptics.light();
		setFinishing(true);
	};
	const keepGoing = () => {
		timerStore.keepGoing();
		haptics.light();
		setFinishing(false);
		announce(t.t("tracker.session.running"));
	};
	const save = () => {
		const state = getTimer();
		if (!state || state.habitId !== habit.id) return;
		const now = Date.now();
		const seconds = timerSeconds(state, now);
		const saved = actions.addTrackerEntry(timerEntry(state, now, note));
		if (!saved) {
			haptics.warning();
			showToast(t.t("tracker.saveFailed"), { tone: "danger" });
			return;
		}
		timerStore.clear();
		haptics.success();
		const latest = store.getState();
		const line = trackerDayLine(
			latest.data.habits[habit.id] ?? habit,
			trackerEntryIndexOf(latest.data.trackerEntries),
			state.day,
			today,
			t,
		);
		const message = t.t("tracker.session.saved", { duration: t.formatDuration(seconds) });
		showToast(line ? `${message} · ${line}` : message, {
			tone: "success",
			action: { label: t.t("common.undo"), onPress: () => actions.deleteTrackerEntry(saved.id) },
		});
		closeHabitScreen(habit.id);
	};
	const discard = () => {
		timerStore.clear();
		haptics.medium();
		setFinishing(false);
		setNote("");
		showToast(t.t("tracker.session.discarded"));
	};
	const allowBell = async () => {
		const granted = await request();
		const state = getTimer();
		if (granted && state && state.habitId === habit.id)
			void scheduleTimerBell(state, displayHabit(habit, text), t);
	};

	// The ring: a countdown empties; a stopwatch sweeps once a minute; time's up closes it in the accent.
	const progress = timeUp
		? 1
		: mine
			? view?.remainingMs !== null && view?.remainingMs !== undefined && mine.presetSec
				? view.remainingMs / (mine.presetSec * 1000)
				: ((view?.elapsedMs ?? 0) % 60_000) / 60_000
			: 1;
	const clock = mine
		? (view?.clock ?? "00:00")
		: formatTimerClock(mode === "countdown" ? minutes * 60_000 : 0);
	const sub = mine
		? [
				mine.label,
				mine.presetSec && !mine.overtime
					? t.t("tracker.session.of", { duration: t.formatDuration(mine.presetSec) })
					: null,
			]
				.filter(Boolean)
				.join(" · ")
		: "";
	const breathOn = breathing && running && !timeUp && !finishing;
	const phaseMs = (view?.elapsedMs ?? 0) % BREATH_MS;
	const phaseIn = breathOn ? phaseMs < BREATH_IN_MS : false;
	const status = !mine
		? t.t("tracker.session.ready")
		: timeUp
			? t.t("tracker.session.timeUpShort")
			: running
				? breathOn
					? phaseIn
						? t.t("tracker.session.breatheIn")
						: t.t("tracker.session.breatheOut")
					: t.t("tracker.session.running")
				: t.t("tracker.session.paused");

	const allTopics = [...topics, ...extraTopics.filter((x) => !topics.includes(x))];
	const addTopic = () => {
		const value = topicDraft.trim().slice(0, 60);
		if (!value) return;
		if (!allTopics.some((x) => x.toLowerCase() === value.toLowerCase())) {
			setExtraTopics((list) => [...list, value]);
		}
		haptics.selection();
		setLabel(value);
		setTopicDraft("");
	};
	const countdownBell =
		Platform.OS !== "web" &&
		permission !== null &&
		!permission.granted &&
		(mine ? mine.presetSec !== null && !mine.overtime && !timeUp : mode === "countdown");

	const size = Math.min(width - 80, 300);
	return (
		<View style={styles.body}>
			{other && otherHabit ? (
				<View style={styles.other}>
					<Text variant="small" weight="semibold">
						{t.t("tracker.session.finishFirst", { habit: text.habit(otherHabit, "name") })}
					</Text>
					<Text variant="small" tone="muted">
						{t.t("tracker.session.finishFirstBody")}
					</Text>
					<Button
						label={t.t("tracker.session.goTo", { habit: text.habit(otherHabit, "name") })}
						variant="secondary"
						size="sm"
						onPress={() =>
							router.replace({ pathname: "/habit/timer", params: { id: otherHabit.id } })
						}
						style={styles.start}
					/>
				</View>
			) : null}

			<View style={[styles.ringWrap, { width: size, height: size }]}>
				<TimerRing
					size={size}
					progress={progress}
					color={timeUp ? colors.accent : tone.fill}
					track={tone.soft}
					animate={!reduceMotion}
				/>
				{breathing && mine && !reduceMotion ? (
					<BreathCircle size={size * 0.72} color={tone.softer} on={breathOn} phaseMs={phaseMs} />
				) : null}
				<View style={styles.face} pointerEvents="none">
					<Text variant="small" tone="muted" align="center" accessibilityLiveRegion="polite">
						{status}
					</Text>
					<Text
						style={styles.clock}
						tone={mine && !running && !timeUp ? "muted" : "default"}
						accessibilityRole="timer"
						accessibilityLabel={`${clock} · ${status}`}
						allowFontScaling={false}
						tabular
					>
						{clock}
					</Text>
					<Text variant="small" tone="muted" align="center" numberOfLines={1} style={styles.sub}>
						{sub}
					</Text>
				</View>
			</View>

			{showFinish ? (
				<View style={styles.panel}>
					<Text variant="display" align="center">
						{timeUp
							? t.t("tracker.session.timeUp")
							: t.t("tracker.session.finished", {
									duration: t.formatDuration(mine ? timerSeconds(mine, Date.now()) : 0),
								})}
					</Text>
					<Textarea
						label={
							config.prompt === "learned"
								? t.t("tracker.session.learnedPrompt")
								: config.prompt === "felt"
									? t.t("tracker.session.feltPrompt")
									: t.t("tracker.note")
						}
						value={note}
						onChangeText={setNote}
						maxLength={500}
						minRows={2}
						maxRows={6}
						placeholder={t.t("tracker.session.notePlaceholder")}
					/>
					<Button
						label={t.t("tracker.save")}
						icon={Check}
						size="lg"
						fullWidth
						onPress={save}
						testID="timer-save"
					/>
					{timeUp ? (
						<Button
							label={t.t("tracker.session.keepGoing")}
							icon={RotateCcw}
							variant="secondary"
							size="lg"
							fullWidth
							onPress={keepGoing}
							testID="timer-keep-going"
						/>
					) : (
						<Button
							label={t.t("tracker.session.resume")}
							icon={Play}
							variant="secondary"
							size="lg"
							fullWidth
							onPress={resume}
						/>
					)}
					<Button
						label={t.t("tracker.session.discard")}
						variant="ghost"
						fullWidth
						onPress={() => setConfirmDiscard(true)}
						testID="timer-discard"
					/>
				</View>
			) : mine ? (
				<View style={styles.panel}>
					<View style={styles.controls}>
						{running ? (
							<Button
								label={t.t("tracker.session.pause")}
								icon={Pause}
								variant="secondary"
								size="lg"
								onPress={pause}
								style={styles.control}
								testID="timer-pause"
							/>
						) : (
							<Button
								label={t.t("tracker.session.resume")}
								icon={Play}
								variant="secondary"
								size="lg"
								onPress={resume}
								style={styles.control}
								testID="timer-resume"
							/>
						)}
						<Button
							label={t.t("tracker.session.finish")}
							icon={Square}
							size="lg"
							onPress={finish}
							style={styles.control}
							testID="timer-finish"
						/>
					</View>
					<TextLink
						label={t.t("tracker.session.discard")}
						onPress={() => setConfirmDiscard(true)}
					/>
				</View>
			) : (
				<View style={styles.panel}>
					<ToggleGroup<"countdown" | "stopwatch">
						type="single"
						accessibilityLabel={t.t("tracker.session.mode")}
						value={mode}
						onChange={setMode}
						fill
						options={[
							{ value: "countdown", label: t.t("tracker.session.countdown") },
							{ value: "stopwatch", label: t.t("tracker.session.stopwatch") },
						]}
						testID="timer-mode"
					/>
					{mode === "countdown" ? (
						<View style={styles.group}>
							<Text variant="small" weight="medium" tone="muted" align="center">
								{t.t("tracker.session.length")}
							</Text>
							<ToggleGroup<number>
								type="single"
								size="sm"
								scroll
								accessibilityLabel={t.t("tracker.session.length")}
								value={minutes}
								onChange={setMinutes}
								options={[...new Set([...LENGTHS, config.preset ?? 10])]
									.sort((a, b) => a - b)
									.map((m) => ({ value: m, label: t.formatDuration(m * 60) }))}
								testID="timer-length"
							/>
						</View>
					) : null}
					<View style={styles.group}>
						<Text variant="small" weight="medium" tone="muted" align="center">
							{t.t("tracker.session.label")}
						</Text>
						{allTopics.length ? (
							<ToggleGroup<string>
								type="single"
								size="sm"
								scroll
								accessibilityLabel={t.t("tracker.session.label")}
								value={label}
								onChange={(next) => setLabel(next === label ? null : next)}
								options={allTopics.map((topic) => ({ value: topic, label: topic }))}
							/>
						) : null}
						<View style={styles.topicRow}>
							<TextField
								value={topicDraft}
								onChangeText={setTopicDraft}
								maxLength={60}
								placeholder={t.t("tracker.session.addTopic")}
								accessibilityLabel={t.t("tracker.session.addTopic")}
								onSubmitEditing={addTopic}
								returnKeyType="done"
								containerStyle={styles.grow}
							/>
							<PressableScale
								onPress={addTopic}
								disabled={!topicDraft.trim()}
								accessibilityRole="button"
								accessibilityLabel={t.t("tracker.session.addTopic")}
								accessibilityState={{ disabled: !topicDraft.trim() }}
								style={[styles.addTopic, !topicDraft.trim() && { opacity: 0.45 }]}
							>
								<Plus size={18} color={colors.text} strokeWidth={2.2} />
							</PressableScale>
						</View>
					</View>
					<Button
						label={t.t("tracker.session.start")}
						icon={Play}
						size="lg"
						fullWidth
						onPress={start}
						disabled={!!other}
						testID="timer-start"
					/>
					<TextLink
						label={t.t("tracker.session.logManually")}
						onPress={() => ui.openEntryComposer({ habitId: habit.id, day })}
					/>
				</View>
			)}

			<View style={styles.footer}>
				{countdownBell ? (
					<View style={styles.bellHint}>
						<BellRing size={16} color={colors.textMuted} style={{ marginTop: 2 }} />
						<View style={styles.grow}>
							<Text variant="small" tone="muted">
								{t.t("tracker.session.backgroundHint")}
							</Text>
							<TextLink label={t.x("settings.remindersEnable")} onPress={allowBell} align="left" />
						</View>
					</View>
				) : null}
				<View style={styles.breathRow}>
					<Wind size={16} color={colors.textMuted} />
					<Text variant="small" tone="muted">
						{t.t("tracker.session.breathing")}
					</Text>
					<Switch
						value={breathing}
						onValueChange={setBreathing}
						accessibilityLabel={t.t("tracker.session.breathing")}
						testID="timer-breathing"
					/>
				</View>
			</View>

			<ConfirmSheet
				open={confirmDiscard}
				title={t.t("tracker.session.discard")}
				body={t.t("tracker.session.discardConfirm")}
				confirmLabel={t.t("tracker.session.discard")}
				destructive
				onConfirm={discard}
				onClose={() => setConfirmDiscard(false)}
			/>
		</View>
	);
}

function TextLink({
	label,
	onPress,
	align = "center",
}: {
	label: string;
	onPress(): void;
	align?: "center" | "left";
}) {
	const styles = useStyles();
	return (
		<PressableScale
			onPress={() => {
				haptics.selection();
				onPress();
			}}
			hitSlop={8}
			accessibilityRole="button"
			accessibilityLabel={label}
			style={[styles.link, align === "left" && styles.linkLeft]}
		>
			<Text variant="small" weight="semibold" tone="muted" style={styles.underline}>
				{label}
			</Text>
		</PressableScale>
	);
}

/** The countdown ring; it eases between ticks (jumps under reduce motion). */
function TimerRing({
	size,
	progress,
	color,
	track,
	animate,
}: {
	size: number;
	progress: number;
	color: string;
	track: string;
	animate: boolean;
}) {
	const stroke = 7;
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const clamped = Math.max(0, Math.min(1, progress));
	const value = useSharedValue(clamped);
	useEffect(() => {
		value.value = animate ? withTiming(clamped, { duration: 280, easing: Easing.linear }) : clamped;
	}, [clamped, animate, value]);
	const arcProps = useAnimatedProps(() => ({
		strokeDashoffset: circumference * (1 - value.value),
	}));
	return (
		<Svg width={size} height={size} style={StyleSheet.absoluteFill}>
			<Circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				stroke={track}
				strokeWidth={stroke}
				fill="none"
			/>
			<AnimatedCircle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				stroke={color}
				strokeWidth={stroke}
				strokeLinecap="round"
				fill="none"
				strokeDasharray={`${circumference} ${circumference}`}
				animatedProps={arcProps}
				transform={`rotate(-90 ${size / 2} ${size / 2})`}
			/>
		</Svg>
	);
}

/** The breathing guide: swells for 4 s, settles for 6 s (in step with "Breathe in / out"). */
function BreathCircle({
	size,
	color,
	on,
	phaseMs,
}: {
	size: number;
	color: string;
	on: boolean;
	phaseMs: number;
}) {
	const ease = (x: number) => 0.5 - Math.cos(Math.PI * Math.max(0, Math.min(1, x))) / 2;
	const target = !on
		? 0.86
		: phaseMs < BREATH_IN_MS
			? 0.72 + 0.28 * ease(phaseMs / BREATH_IN_MS)
			: 1 - 0.28 * ease((phaseMs - BREATH_IN_MS) / (BREATH_MS - BREATH_IN_MS));
	const scale = useSharedValue(target);
	useEffect(() => {
		scale.value = withTiming(target, { duration: on ? 260 : 600, easing: Easing.linear });
	}, [target, on, scale]);
	const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
	return (
		<Animated.View
			pointerEvents="none"
			style={[
				{
					position: "absolute",
					width: size,
					height: size,
					borderRadius: size / 2,
					backgroundColor: color,
				},
				style,
			]}
		/>
	);
}

const useStyles = makeStyles((t) => ({
	body: { alignItems: "center", gap: 24, paddingTop: 12 },
	grow: { flex: 1 },
	start: { alignSelf: "flex-start", marginTop: 4 },
	other: {
		alignSelf: "stretch",
		gap: 4,
		padding: 14,
		borderRadius: t.radii.lg,
		backgroundColor: t.colors.warningSoft,
	},
	ringWrap: { alignItems: "center", justifyContent: "center" },
	face: { alignItems: "center", gap: 4, paddingHorizontal: 24 },
	clock: { fontFamily: fonts.serif, fontSize: 68, lineHeight: 78 },
	sub: { minHeight: 18, maxWidth: 220 },
	panel: { alignSelf: "stretch", gap: 14 },
	controls: { flexDirection: "row", gap: 12 },
	control: { flex: 1 },
	group: { gap: 8 },
	topicRow: { flexDirection: "row", alignItems: "center", gap: 8 },
	addTopic: {
		width: 48,
		height: 48,
		borderRadius: 24,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	link: { alignSelf: "center", minHeight: 36, justifyContent: "center", paddingHorizontal: 8 },
	linkLeft: { alignSelf: "flex-start", paddingHorizontal: 0 },
	underline: { textDecorationLine: "underline" },
	footer: { alignSelf: "stretch", gap: 14, paddingTop: 4 },
	bellHint: {
		flexDirection: "row",
		gap: 10,
		padding: 12,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	breathRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 10,
	},
}));
