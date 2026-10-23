import { Check, ChevronLeft, CloudOff, FilePlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { fonts, makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type DayKey,
	type Habit,
	type TrackerConfig,
	type TrackerEntry,
	countWords,
	entryMoment,
	recentValues,
	trackerDayLine,
	trackerEntryIndexOf,
} from "@atomic/core";
import {
	useActions,
	useAtomicStore,
	useDayTrackerEntries,
	useHabit,
	useText,
	useToday,
	useTracker,
	useTrackerEntry,
	useTrackerEntryIndex,
} from "@atomic/core/react";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AccessibilityInfo,
	AppState,
	BackHandler,
	KeyboardAvoidingView,
	Platform,
	ScrollView,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { deviceStorage } from "./device-storage";
import { HabitScreen, ScreenNotice, closeHabitScreen } from "./habit-screen";

type WritingConfig = Extract<TrackerConfig, { type: "writing" }>;

/** A page holds at most this many characters (`ENTRY_DATA.writing.text`). */
const PAGE_MAX = 16_000;
/** Drafts go to the device a second after typing stops; pages to the store every minute. */
const DRAFT_DELAY_MS = 1000;
const COMMIT_EVERY_MS = 60_000;

interface Draft {
	text: string;
	title: string;
	project: string;
	savedAt: number;
	/** The entry this draft was last committed to (a page started here gets one on its first commit). */
	entryId: string | null;
}

const DRAFT_PREFIX = "atomic-habits:draft:";
/** Drafts nobody came back to are cleared after a month. */
const DRAFT_MAX_AGE_MS = 30 * 86_400_000;

/** `atomic-habits:draft:<entryId | new:habitId:day>`: fixed for the life of the pad. */
const draftKey = (entryId: string | null, habitId: string, day: DayKey) =>
	`${DRAFT_PREFIX}${entryId ?? `new:${habitId}:${day}`}`;

function readDraft(key: string): Draft | null {
	try {
		const raw = deviceStorage.get(key);
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<Draft>;
		if (typeof value.text !== "string") return null;
		return {
			text: value.text.slice(0, PAGE_MAX),
			title: typeof value.title === "string" ? value.title : "",
			project: typeof value.project === "string" ? value.project : "",
			savedAt: typeof value.savedAt === "number" ? value.savedAt : 0,
			entryId: typeof value.entryId === "string" ? value.entryId : null,
		};
	} catch {
		return null;
	}
}

const writeDraft = (key: string, draft: Draft): boolean =>
	deviceStorage.set(key, JSON.stringify(draft));

/** Removes drafts older than a month (pages abandoned without Done). */
function pruneDrafts(now: number): void {
	for (const key of deviceStorage.keys(DRAFT_PREFIX)) {
		const draft = readDraft(key);
		if (!draft || now - draft.savedAt > DRAFT_MAX_AGE_MS) deviceStorage.remove(key);
	}
}

const announce = (message: string) => AccessibilityInfo.announceForAccessibility(message);

/**
 * The full-screen writing pad (Annex K §1.8.5, §5.2): an optional title, a
 * project, and a distraction-free page with a live word count and a ring
 * toward the day's goal ("214 / 300 words"). Typing is saved as a draft on
 * the device every second; the page itself is committed on Done, on
 * leaving, when the app goes to the background and every minute — never a
 * prompt. A reload or a killed app continues the same entry from its draft.
 * Owner: T4.
 */
export function WriteScreen({
	habitId,
	day,
	entry: entryParam,
}: {
	habitId: string;
	day?: DayKey;
	entry?: string;
}) {
	const t = useT();
	const habit = useHabit(habitId);
	const tracker = useTracker(habit);
	const entry = useTrackerEntry(entryParam);
	const today = useToday();
	const usable = habit && tracker?.active && tracker.config.type === "writing" && !habit.archivedAt;
	if (!habit || !usable) {
		return (
			<HabitScreen habit={habit} habitId={habitId} testID="habit-write">
				{!habit ? (
					<ScreenNotice title={t.t("notFound.title")} body={t.t("notFound.body")} />
				) : (
					<ScreenNotice
						title={t.t("tracker.type.writing.name")}
						body={habit.archivedAt ? t.t("tracker.archived") : t.t("tracker.readOnly")}
						habitId={habit.id}
					/>
				)}
			</HabitScreen>
		);
	}
	// Continue a page only when it is this habit's live writing entry.
	const page =
		entry && !entry.deletedAt && entry.habitId === habit.id && entry.type === "writing"
			? entry
			: null;
	return (
		<WritePad
			key={page?.id ?? `new:${day ?? today}`}
			habit={habit}
			config={tracker.config as WritingConfig}
			page={page}
			day={page?.date ?? day ?? today}
		/>
	);
}

function WritePad({
	habit,
	config,
	page,
	day,
}: {
	habit: Habit;
	config: WritingConfig;
	page: TrackerEntry | null;
	day: DayKey;
}) {
	const t = useT();
	const text = useText();
	const actions = useActions();
	const store = useAtomicStore();
	const today = useToday();
	const index = useTrackerEntryIndex();
	const insets = useSafeAreaInsets();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const dayEntries = useDayTrackerEntries(habit.id, day);
	const tone = toneOf(habit.color);

	// One device draft per pad, under a key that never changes while it is open. A new page
	// remembers the entry its first commit created, so a killed app continues that entry, and
	// rebuilds it from the draft if the store never got to save it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the pad starts from a snapshot.
	const start = useMemo(() => {
		pruneDrafts(Date.now());
		const key = draftKey(page?.id ?? null, habit.id, day);
		const draft = readDraft(key);
		const linkedId = page?.id ?? draft?.entryId ?? null;
		const linked = linkedId ? store.getState().data.trackerEntries[linkedId] : undefined;
		const entry =
			linked && !linked.deletedAt && linked.habitId === habit.id && linked.type === "writing"
				? linked
				: null;
		const saved = {
			text: typeof entry?.data.text === "string" ? entry.data.text : "",
			title: typeof entry?.data.title === "string" ? entry.data.title : "",
			project: typeof entry?.data.project === "string" ? entry.data.project : "",
		};
		const fresh = {
			...saved,
			project:
				entry || saved.project
					? saved.project
					: (recentValues(index, habit.id, "writing", "project", 1, today)[0] ?? ""),
		};
		const shown =
			draft && draft.savedAt > (entry?.updatedAt ?? 0)
				? { text: draft.text, title: draft.title, project: draft.project }
				: fresh;
		return { key, entryId: entry?.id ?? null, saved, shown };
	}, []);
	const key = start.key;
	const [body, setBody] = useState(start.shown.text);
	const [title, setTitle] = useState(start.shown.title);
	const [project, setProject] = useState(start.shown.project);
	const [projectFocused, setProjectFocused] = useState(false);
	const [status, setStatus] = useState<"idle" | "draft" | "saved" | "error">("idle");
	const entryId = useRef<string | null>(start.entryId);
	const committed = useRef(start.saved);
	const latest = useRef({ body, title, project });
	latest.current = { body, title, project };
	const pageRef = useRef<TextInput>(null);

	const words = countWords(body);
	const otherWords = dayEntries
		.filter((e) => e.type === "writing" && e.id !== entryId.current)
		.reduce((sum, e) => sum + (typeof e.data.words === "number" ? e.data.words : 0), 0);
	const dayWords = otherWords + words;
	const goal = config.measure === "words" ? habit.target : null;
	const full = body.length >= PAGE_MAX;
	const projects = useMemo(
		() => recentValues(index, habit.id, "writing", "project", 8, today),
		[index, habit.id, today],
	);

	/**
	 * Writes the page to the store when it changed; true when the store has it. The device
	 * draft stays (linked to the entry) until Done: a killed app may not have saved the store.
	 */
	const commit = useCallback((): boolean => {
		const current = latest.current;
		const data = {
			text: current.body,
			title: current.title.trim() || null,
			project: current.project.trim() || null,
		};
		const before = committed.current;
		if (
			before.text === current.body &&
			before.title === (data.title ?? "") &&
			before.project === (data.project ?? "")
		) {
			return true;
		}
		if (entryId.current) {
			const saved = actions.updateTrackerEntry(entryId.current, { data });
			if (!saved) return false;
		} else {
			if (!current.body.trim()) return true;
			const saved = actions.addTrackerEntry({
				habitId: habit.id,
				date: day,
				type: "writing",
				at: entryMoment(day, today, Date.now()),
				data,
			});
			if (!saved) return false;
			entryId.current = saved.id;
		}
		committed.current = {
			text: current.body,
			title: data.title ?? "",
			project: data.project ?? "",
		};
		writeDraft(key, {
			text: current.body,
			title: current.title,
			project: current.project,
			savedAt: Date.now(),
			entryId: entryId.current,
		});
		return true;
	}, [actions, habit.id, day, today, key]);

	// Device draft a second after typing stops.
	useEffect(() => {
		const changed =
			body !== committed.current.text ||
			title !== committed.current.title ||
			project !== committed.current.project;
		// A blank new page leaves nothing on the device.
		if (!changed || (!entryId.current && !body.trim() && !title.trim())) return;
		const id = setTimeout(() => {
			const ok = writeDraft(key, {
				text: body,
				title,
				project,
				savedAt: Date.now(),
				entryId: entryId.current,
			});
			setStatus(ok ? "draft" : "error");
		}, DRAFT_DELAY_MS);
		return () => clearTimeout(id);
	}, [body, title, project, key]);

	// The page itself: every minute, when the app goes to the background, and on leaving.
	useEffect(() => {
		const save = () => {
			if (commit()) setStatus((s) => (s === "draft" ? "saved" : s));
		};
		const interval = setInterval(save, COMMIT_EVERY_MS);
		const sub = AppState.addEventListener("change", (state) => {
			if (state !== "active") save();
		});
		return () => {
			clearInterval(interval);
			sub.remove();
			commit();
		};
	}, [commit]);

	// Word count milestones for screen readers: every 50 words, and the goal.
	const spoken = useRef(Math.floor(dayWords / 50));
	const goalSpoken = useRef(goal !== null && dayWords >= goal);
	useEffect(() => {
		if (goal !== null && dayWords >= goal && !goalSpoken.current) {
			goalSpoken.current = true;
			haptics.success();
			announce(t.t("tracker.writing.goalReached", { count: t.number(dayWords) }));
			return;
		}
		const step = Math.floor(dayWords / 50);
		if (step > spoken.current) announce(t.tp("tracker.unit.words", dayWords));
		spoken.current = step;
	}, [dayWords, goal, t]);

	// A new page opens ready to type.
	// biome-ignore lint/correctness/useExhaustiveDependencies: on open only.
	useEffect(() => {
		if (start.shown.text) return;
		const id = setTimeout(() => pageRef.current?.focus(), 350);
		return () => clearTimeout(id);
	}, []);

	const leave = () => {
		commit();
		closeHabitScreen(habit.id);
	};

	// Android back: save, then leave (never a prompt).
	useEffect(() => {
		if (Platform.OS === "web") return;
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			commit();
			return false;
		});
		return () => sub.remove();
	}, [commit]);

	const done = () => {
		if (!commit()) {
			haptics.warning();
			showToast(t.t("tracker.saveFailed"), { tone: "danger" });
			return;
		}
		// Leaving through Done: the store has the page, so the draft can go.
		deviceStorage.remove(key);
		haptics.light();
		if (entryId.current) {
			const state = store.getState();
			const line = trackerDayLine(
				state.data.habits[habit.id] ?? habit,
				trackerEntryIndexOf(state.data.trackerEntries),
				day,
				today,
				t,
			);
			showToast(line ? `${t.t("tracker.entrySaved")} · ${line}` : t.t("tracker.entrySaved"), {
				tone: "success",
			});
		}
		closeHabitScreen(habit.id);
	};

	const newPage = () => {
		if (!commit()) {
			haptics.warning();
			showToast(t.t("tracker.saveFailed"), { tone: "danger" });
			return;
		}
		// A blank page for the same day and project; the full one is in the store.
		const keep = latest.current.project;
		entryId.current = null;
		committed.current = { text: "", title: "", project: keep };
		setBody("");
		setTitle("");
		setStatus("idle");
		deviceStorage.remove(key);
		const blank = { text: "", title: "", project: keep, savedAt: Date.now(), entryId: null };
		writeDraft(page ? draftKey(null, habit.id, day) : key, blank);
		haptics.light();
		if (page) {
			router.replace({
				pathname: "/habit/write",
				params: day === today ? { id: habit.id } : { id: habit.id, day },
			});
		} else pageRef.current?.focus();
	};

	const progress = goal ? Math.min(1, dayWords / goal) : 0;
	const countLabel = goal
		? t.t("tracker.writing.goal", { count: t.number(dayWords), target: t.number(goal) })
		: t.tp("tracker.unit.words", dayWords);
	const projectMatches = projects.filter(
		(p) => p !== project && (!project || p.toLowerCase().startsWith(project.toLowerCase())),
	);
	const name = text.habit(habit, "name");

	return (
		<KeyboardAvoidingView
			style={styles.root}
			behavior={Platform.OS === "web" ? undefined : "padding"}
			testID="habit-write"
		>
			<View style={[styles.bar, { paddingTop: insets.top }]}>
				<View style={styles.barRow}>
					<IconButton
						icon={ChevronLeft}
						variant="soft"
						size={38}
						iconSize={22}
						accessibilityLabel={t.t("common.back")}
						onPress={leave}
						testID="back-button"
					/>
					<View
						style={styles.count}
						accessible
						accessibilityLabel={countLabel}
						accessibilityRole="text"
					>
						{goal ? (
							<WordRing
								progress={progress}
								color={progress >= 1 ? colors.accent : tone.fill}
								track={tone.soft}
							/>
						) : null}
						<Text variant="small" tone="muted" tabular numberOfLines={1} style={styles.countText}>
							{goal ? `${t.number(dayWords)} / ${t.number(goal)}` : countLabel}
						</Text>
					</View>
					<Button
						label={t.t("tracker.writing.done")}
						icon={Check}
						size="sm"
						onPress={done}
						testID="write-done"
					/>
				</View>
			</View>
			{/* The page scrolls itself (it follows the caret above the keyboard); the rest stays put. */}
			<View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) }]}>
				<View style={styles.meta}>
					<Text variant="tiny" tone="subtle" numberOfLines={1} style={styles.grow}>
						{`${habit.emoji} ${name} · ${t.formatRelativeDay(day, today)}`}
					</Text>
					<View style={styles.status} accessibilityLiveRegion="polite">
						{status === "error" ? (
							<>
								<CloudOff size={13} color={colors.danger} />
								<Text variant="tiny" tone="danger">
									{t.t("tracker.writing.draftFailed")}
								</Text>
							</>
						) : status === "draft" ? (
							<Text variant="tiny" tone="subtle">
								{t.t("tracker.writing.draftSaved")}
							</Text>
						) : status === "saved" ? (
							<>
								<Check size={13} color={colors.textSubtle} />
								<Text variant="tiny" tone="subtle">
									{t.t("tracker.writing.saved")}
								</Text>
							</>
						) : null}
					</View>
				</View>
				<TextInput
					value={title}
					onChangeText={setTitle}
					maxLength={120}
					placeholder={t.t("tracker.writing.titlePlaceholder")}
					placeholderTextColor={colors.textSubtle}
					selectionColor={colors.accent}
					cursorColor={colors.accent}
					accessibilityLabel={t.t("tracker.writing.title")}
					returnKeyType="next"
					onSubmitEditing={() => pageRef.current?.focus()}
					maxFontSizeMultiplier={1.3}
					style={styles.title}
					testID="write-title"
				/>
				<View style={styles.projectWrap}>
					<TextInput
						value={project}
						onChangeText={setProject}
						maxLength={60}
						placeholder={t.t("tracker.writing.projectPlaceholder")}
						placeholderTextColor={colors.textSubtle}
						selectionColor={colors.accent}
						cursorColor={colors.accent}
						accessibilityLabel={t.t("tracker.writing.project")}
						onFocus={() => setProjectFocused(true)}
						onBlur={() => setProjectFocused(false)}
						returnKeyType="done"
						maxFontSizeMultiplier={1.4}
						style={[
							styles.project,
							{ borderColor: projectFocused ? colors.accent : colors.border },
						]}
					/>
					{projectFocused && projectMatches.length ? (
						<ScrollView
							horizontal
							keyboardShouldPersistTaps="always"
							showsHorizontalScrollIndicator={false}
							contentContainerStyle={styles.suggestions}
						>
							{projectMatches.map((value) => (
								<Button
									key={value}
									label={value}
									variant="soft"
									size="sm"
									onPress={() => {
										haptics.selection();
										setProject(value);
									}}
								/>
							))}
						</ScrollView>
					) : null}
				</View>
				<TextInput
					ref={pageRef}
					value={body}
					onChangeText={setBody}
					onBlur={() => {
						if (commit()) setStatus((s) => (s === "draft" ? "saved" : s));
					}}
					maxLength={PAGE_MAX}
					multiline
					scrollEnabled
					textAlignVertical="top"
					placeholder={config.prompt ?? t.t("tracker.writing.placeholder")}
					placeholderTextColor={colors.textSubtle}
					selectionColor={colors.accent}
					cursorColor={colors.accent}
					accessibilityLabel={title.trim() || t.t("tracker.writing.pageLabel")}
					maxFontSizeMultiplier={1.6}
					style={styles.page}
					testID="write-page"
				/>
				{full ? (
					<View style={styles.full}>
						<Text variant="small" style={styles.grow}>
							{t.t("tracker.writing.full")}
						</Text>
						<Button
							label={t.t("tracker.writing.newPage")}
							icon={FilePlus}
							variant="secondary"
							size="sm"
							onPress={newPage}
						/>
					</View>
				) : null}
			</View>
		</KeyboardAvoidingView>
	);
}

/** The small ring toward the day's word goal. */
function WordRing({ progress, color, track }: { progress: number; color: string; track: string }) {
	const size = 26;
	const stroke = 3.5;
	const r = (size - stroke) / 2;
	const c = 2 * Math.PI * r;
	return (
		<Svg width={size} height={size} aria-hidden>
			<Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
			<Circle
				cx={size / 2}
				cy={size / 2}
				r={r}
				stroke={color}
				strokeWidth={stroke}
				strokeLinecap="round"
				fill="none"
				strokeDasharray={`${c} ${c}`}
				strokeDashoffset={c * (1 - progress)}
				transform={`rotate(-90 ${size / 2} ${size / 2})`}
			/>
		</Svg>
	);
}

const useStyles = makeStyles((t) => ({
	root: { flex: 1, backgroundColor: t.colors.bg },
	grow: { flex: 1 },
	bar: { backgroundColor: t.colors.bg, borderBottomWidth: 1, borderBottomColor: t.colors.border },
	barRow: {
		height: 56,
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 14,
		gap: 10,
	},
	count: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "flex-end",
		gap: 8,
	},
	countText: { flexShrink: 1 },
	content: { flex: 1, paddingHorizontal: 20, paddingTop: 16, gap: 12 },
	meta: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 18 },
	status: { flexDirection: "row", alignItems: "center", gap: 4 },
	title: {
		fontFamily: fonts.serif,
		fontSize: 32,
		lineHeight: 40,
		color: t.colors.text,
		paddingVertical: 4,
		outlineWidth: 0,
	},
	projectWrap: { gap: 8 },
	project: {
		alignSelf: "flex-start",
		minWidth: 160,
		maxWidth: "80%",
		height: 34,
		paddingHorizontal: 12,
		borderRadius: 999,
		borderWidth: 1,
		fontFamily: fonts.medium,
		fontSize: 13,
		color: t.colors.text,
		backgroundColor: t.colors.surface,
		outlineWidth: 0,
	},
	suggestions: { flexDirection: "row", gap: 8 },
	page: {
		flex: 1,
		minHeight: 120,
		fontFamily: fonts.regular,
		fontSize: 17,
		lineHeight: 28,
		color: t.colors.text,
		paddingTop: 4,
		paddingBottom: 24,
		outlineWidth: 0,
	},
	full: {
		flexDirection: "row",
		alignItems: "center",
		flexWrap: "wrap",
		gap: 12,
		padding: 14,
		borderRadius: t.radii.lg,
		backgroundColor: t.colors.accentSoft,
	},
}));
