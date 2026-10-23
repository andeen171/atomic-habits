import { announce } from "@/lib/announce";
import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
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
import { useNavigate } from "@tanstack/react-router";
import { Check, CloudOff, FilePlus2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Combobox } from "../ui/combobox";
import { Textarea } from "../ui/field";
import { HabitScreen, ScreenNotice, useCloseScreen } from "./habit-screen";

type WritingConfig = Extract<TrackerConfig, { type: "writing" }>;

/** A page holds at most this many characters (`ENTRY_DATA.writing.text`). */
const PAGE_MAX = 16_000;
/** Drafts are written to the device a second after typing stops; pages to the store every minute. */
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
		const raw = localStorage.getItem(key);
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

function writeDraft(key: string, draft: Draft): boolean {
	try {
		localStorage.setItem(key, JSON.stringify(draft));
		return true;
	} catch {
		return false;
	}
}

function dropDraft(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// Nothing to clean up.
	}
}

/** Removes drafts older than a month (pages abandoned without Done). */
function pruneDrafts(now: number): void {
	try {
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const key = localStorage.key(i);
			if (!key?.startsWith(DRAFT_PREFIX)) continue;
			const draft = readDraft(key);
			if (!draft || now - draft.savedAt > DRAFT_MAX_AGE_MS) localStorage.removeItem(key);
		}
	} catch {
		// Storage unavailable: nothing to prune.
	}
}

/**
 * The full-screen writing pad (Annex K §1.8.5, §4.2): an optional title, a
 * project, and a distraction-free page with a live word count and a ring
 * toward the day's goal ("214 / 300 words"). Typing is saved as a draft on
 * the device every second; the page itself is committed on Done, on
 * leaving, when the app is hidden and every minute — never a prompt. Owner: T4.
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
	const { t } = useT();
	const habit = useHabit(habitId);
	const tracker = useTracker(habit);
	const entry = useTrackerEntry(entryParam);
	const today = useToday();
	const usable = habit && tracker?.active && tracker.config.type === "writing" && !habit.archivedAt;
	if (!habit || !usable) {
		return (
			<HabitScreen habit={habit} habitId={habitId}>
				{!habit ? (
					<ScreenNotice title={t("notFound.title")} body={t("notFound.body")} />
				) : (
					<ScreenNotice
						title={t("tracker.type.writing.name")}
						body={habit.archivedAt ? t("tracker.archived") : t("tracker.readOnly")}
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
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	const store = useAtomicStore();
	const navigate = useNavigate();
	const today = useToday();
	const index = useTrackerEntryIndex();
	const close = useCloseScreen(habit.id);
	const style = useHabitStyle(habit.color);
	const dayEntries = useDayTrackerEntries(habit.id, day);

	// One device draft per pad, under a key that never changes while it is open. A new page
	// remembers the entry its first commit created, so a reload (or a killed tab) continues
	// that entry, and rebuilds it from the draft if the store never got to save it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the pad starts from a snapshot.
	const start = useMemo(() => {
		pruneDrafts(Date.now());
		const key = draftKey(page?.id ?? null, habit.id, day);
		let draft = readDraft(key);
		const linkedId = page?.id ?? draft?.entryId ?? null;
		const linked = linkedId ? store.getState().data.trackerEntries[linkedId] : undefined;
		if (!page && draft?.entryId && linked?.deletedAt) {
			// The page this draft belonged to was deleted since: never bring its text back.
			dropDraft(key);
			draft = null;
		}
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
	const [status, setStatus] = useState<"idle" | "draft" | "saved" | "error">("idle");
	const entryId = useRef<string | null>(start.entryId);
	const committed = useRef(start.saved);
	const latest = useRef({ body, title, project });
	latest.current = { body, title, project };
	const textRef = useRef<HTMLTextAreaElement>(null);

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
	 * draft stays (linked to the entry) until Done: on a hide or unload the store may not get
	 * to write to disk before the page goes away.
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

	// The page itself: every minute, when the app is hidden, and on leaving.
	useEffect(() => {
		const save = () => {
			if (commit()) setStatus((s) => (s === "draft" ? "saved" : s));
		};
		const interval = setInterval(save, COMMIT_EVERY_MS);
		const onHide = () => {
			if (document.visibilityState === "hidden") save();
		};
		document.addEventListener("visibilitychange", onHide);
		window.addEventListener("pagehide", save);
		return () => {
			clearInterval(interval);
			document.removeEventListener("visibilitychange", onHide);
			window.removeEventListener("pagehide", save);
			commit();
		};
	}, [commit]);

	// Leaving a page started here (in the app; a closed tab keeps the draft for the next
	// visit): the store has it, so its device draft moves under the entry's own key. A new
	// page started later starts blank and never shows, or saves again, this one.
	// biome-ignore lint/correctness/useExhaustiveDependencies: on unmount only, after the commit above.
	useEffect(
		() => () => {
			if (page || !entryId.current) return;
			const draft = readDraft(key);
			if (draft) {
				writeDraft(draftKey(entryId.current, habit.id, day), {
					...draft,
					entryId: entryId.current,
				});
			}
			dropDraft(key);
		},
		[],
	);

	// Word count milestones for screen readers: every 50 words, and the goal.
	const spoken = useRef(Math.floor(dayWords / 50));
	const goalSpoken = useRef(goal !== null && dayWords >= goal);
	useEffect(() => {
		if (goal !== null && dayWords >= goal && !goalSpoken.current) {
			goalSpoken.current = true;
			announce(t("tracker.writing.goalReached", { count: t.number(dayWords) }));
			return;
		}
		const step = Math.floor(dayWords / 50);
		if (step > spoken.current) announce(t.tp("tracker.unit.words", dayWords));
		spoken.current = step;
	}, [dayWords, goal, t]);

	useEffect(() => {
		const el = textRef.current;
		if (!el) return;
		el.focus({ preventScroll: true });
		el.setSelectionRange(el.value.length, el.value.length);
	}, []);

	const done = () => {
		if (!commit()) {
			toast.error(t("tracker.saveFailed"));
			return;
		}
		// Leaving through Done: the app keeps running and saves the store, so the draft can go.
		dropDraft(key);
		if (entryId.current) {
			const state = store.getState();
			const line = trackerDayLine(
				state.data.habits[habit.id] ?? habit,
				trackerEntryIndexOf(state.data.trackerEntries),
				day,
				today,
				t,
			);
			toast(t("tracker.entrySaved"), { description: line ?? text.habit(habit, "name") });
		}
		close();
	};

	const newPage = () => {
		if (!commit()) {
			toast.error(t("tracker.saveFailed"));
			return;
		}
		// A blank page for the same day and project. The URL may already be the
		// new-page one (a page started here), so reset in place rather than rely
		// on a remount.
		const keep = latest.current.project;
		const blank = { text: "", title: "", project: keep, savedAt: Date.now(), entryId: null };
		entryId.current = null;
		committed.current = { text: "", title: "", project: keep };
		setBody("");
		setTitle("");
		setStatus("idle");
		textRef.current?.focus();
		// The full page is in the store; the next one starts blank, here or after the remount.
		dropDraft(key);
		writeDraft(page ? draftKey(null, habit.id, day) : key, blank);
		if (page) {
			void navigate({
				to: "/habits/$habitId/write",
				params: { habitId: habit.id },
				search: day === today ? {} : { day },
				replace: true,
			});
		}
	};

	const progress = goal ? Math.min(1, dayWords / goal) : 0;
	const countLabel = goal
		? t("tracker.writing.goal", { count: t.number(dayWords), target: t.number(goal) })
		: t.tp("tracker.unit.words", dayWords);

	return (
		<HabitScreen
			habit={habit}
			habitId={habit.id}
			aside={
				<div className="flex shrink-0 items-center gap-2.5" style={style}>
					<span className="flex items-center gap-2">
						{goal ? (
							<svg viewBox="0 0 36 36" aria-hidden="true" className="-rotate-90 size-8">
								<circle
									cx="18"
									cy="18"
									r="15"
									fill="none"
									stroke="var(--habit-soft)"
									strokeWidth="4"
								/>
								<circle
									cx="18"
									cy="18"
									r="15"
									fill="none"
									stroke={progress >= 1 ? "var(--accent)" : "var(--habit)"}
									strokeWidth="4"
									strokeLinecap="round"
									strokeDasharray={2 * Math.PI * 15}
									strokeDashoffset={2 * Math.PI * 15 * (1 - progress)}
									className="transition-[stroke-dashoffset] duration-(--atomic-duration-base) motion-reduce:transition-none"
								/>
							</svg>
						) : null}
						{goal ? (
							<>
								<span className="hidden text-ink-muted text-small tabular-nums min-[420px]:inline">
									{countLabel}
								</span>
								{/* Narrow screens: "214/300" next to the ring. */}
								<span className="text-ink-muted text-small tabular-nums min-[420px]:hidden">
									{`${t.number(dayWords)}/${t.number(goal)}`}
								</span>
							</>
						) : (
							<span className="text-ink-muted text-small tabular-nums">{countLabel}</span>
						)}
					</span>
					<Button size="sm" onClick={done}>
						<Check />
						{t("tracker.writing.done")}
					</Button>
				</div>
			}
		>
			<div style={style} className="flex flex-1 flex-col gap-4 py-6 md:py-10">
				<div className="flex min-h-5 items-center justify-between gap-3 text-ink-subtle text-tiny">
					<span>{t.formatRelativeDay(day, today)}</span>
					<span className="flex items-center gap-1.5" aria-live="polite">
						{status === "error" ? (
							<>
								<CloudOff aria-hidden="true" className="size-3.5" />
								{t("tracker.writing.draftFailed")}
							</>
						) : status === "draft" ? (
							t("tracker.writing.draftSaved")
						) : status === "saved" ? (
							<>
								<Check aria-hidden="true" className="size-3.5" />
								{t("tracker.writing.saved")}
							</>
						) : null}
					</span>
				</div>
				<input
					type="text"
					value={title}
					maxLength={120}
					aria-label={t("tracker.writing.title")}
					placeholder={t("tracker.writing.titlePlaceholder")}
					onChange={(event) => setTitle(event.target.value)}
					className="w-full bg-transparent font-display text-[2rem] text-ink leading-tight outline-none placeholder:text-ink-subtle/70 md:text-[2.5rem]"
				/>
				<div className="max-w-60">
					<Combobox
						value={project}
						onChange={setProject}
						options={projects.map((value) => ({ value }))}
						maxLength={60}
						aria-label={t("tracker.writing.project")}
						placeholder={t("tracker.writing.projectPlaceholder")}
						className="h-8 rounded-full px-3 text-small"
					/>
				</div>
				<Textarea
					ref={textRef}
					autoGrow
					minRows={12}
					value={body}
					maxLength={PAGE_MAX}
					aria-label={title.trim() || t("tracker.writing.pageLabel")}
					placeholder={config.prompt ?? t("tracker.writing.placeholder")}
					onChange={(event) => setBody(event.target.value)}
					className={cn(
						"flex-1 border-0 bg-transparent px-0 py-0 text-[1.0625rem] leading-[1.75] shadow-none",
						"hover:border-0 focus-visible:bg-transparent focus-visible:ring-0",
					)}
				/>
				{full ? (
					<div className="flex flex-col gap-3 rounded-xl bg-accent-soft px-4 py-3.5 sm:flex-row sm:items-center">
						<p className="min-w-0 flex-1 text-ink text-small">{t("tracker.writing.full")}</p>
						<Button size="sm" variant="secondary" onClick={newPage} className="shrink-0">
							<FilePlus2 />
							{t("tracker.writing.newPage")}
						</Button>
					</div>
				) : null}
			</div>
		</HabitScreen>
	);
}
