import { announce } from "@/lib/announce";
import { primeBell } from "@/lib/bell";
import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { getTimer, timerStore, useTimerState } from "@/lib/timer-store";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";
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
import { Link } from "@tanstack/react-router";
import { Check, Pause, Play, Plus, RotateCcw, Square, Wind } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { controlClass } from "../ui/control";
import { Textarea } from "../ui/field";
import { Switch } from "../ui/switch";
import { ToggleGroup } from "../ui/toggle-group";
import { HabitScreen, ScreenNotice, useCloseScreen } from "./habit-screen";

type SessionConfig = Extract<TrackerConfig, { type: "session" }>;

const LENGTHS = [1, 2, 5, 10, 15, 20, 30, 45, 60];
/** Breathing guide: 4 s in, 6 s out (a calm, longer exhale). */
const BREATH_IN_MS = 4000;
const BREATH_MS = 10_000;

/**
 * The full-screen session timer (Annex K §4.2): a countdown or stopwatch
 * ring in the habit colour with mm:ss in the display serif, topic chips, a
 * breathing guide for meditation, Start / Pause / Finish, "Time's up" with a
 * note prompt, Save, Keep going and Discard. The state is wall-clock based
 * and kept on the device (`lib/timer-store.ts`), so it survives reloads and
 * a killed app; Esc goes back while it keeps running. Owner: T4.
 */
export function TimerScreen({ habitId, day }: { habitId: string; day?: DayKey }) {
	const { t } = useT();
	const habit = useHabit(habitId);
	const tracker = useTracker(habit);
	const usable = habit && tracker?.active && tracker.config.type === "session" && !habit.archivedAt;
	return (
		<HabitScreen habit={habit} habitId={habitId}>
			{!habit ? (
				<ScreenNotice title={t("notFound.title")} body={t("notFound.body")} />
			) : !usable ? (
				<ScreenNotice
					title={t("tracker.type.session.name")}
					body={habit.archivedAt ? t("tracker.archived") : t("tracker.readOnly")}
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
		try {
			const saved = localStorage.getItem(key);
			return saved === null ? fallback : saved === "1";
		} catch {
			return fallback;
		}
	});
	const set = (next: boolean) => {
		setOn(next);
		try {
			localStorage.setItem(key, next ? "1" : "0");
		} catch {
			// Kept for this visit.
		}
	};
	return [on, set];
}

/** Keeps the screen on while the timer runs, where the browser allows it. */
function useWakeLock(active: boolean) {
	useEffect(() => {
		if (!active) return;
		const nav = navigator as Navigator & {
			wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
		};
		if (!nav.wakeLock) return;
		let lock: { release(): Promise<void> } | null = null;
		let cancelled = false;
		const request = () => {
			nav.wakeLock
				?.request("screen")
				.then((l) => {
					if (cancelled) void l.release().catch(() => {});
					else lock = l;
				})
				.catch(() => {});
		};
		request();
		const onVisible = () => {
			if (document.visibilityState === "visible") request();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			cancelled = true;
			document.removeEventListener("visibilitychange", onVisible);
			void lock?.release().catch(() => {});
		};
	}, [active]);
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
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	const store = useAtomicStore();
	const today = useToday();
	const index = useTrackerEntryIndex();
	const close = useCloseScreen(habit.id);
	const openEntryComposer = useUI((s) => s.openEntryComposer);
	const reducedMotion = useReducedMotion();
	const timer = useTimerState();
	const mine = timer?.habitId === habit.id ? timer : null;
	const other = timer && !mine ? timer : null;
	const otherHabit = useHabit(other?.habitId);
	const view = useTimerView(mine);
	const day = dayParam ?? today;
	const name = text.habit(habit, "name");
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
	const noteId = useId();
	const breathId = useId();
	const style = useHabitStyle(habit.color);
	const lastAnnounced = useRef<string | null>(null);

	const running = !!view?.running;
	const timeUp = !!view?.timeUp;
	const showFinish = !!mine && (finishing || timeUp);
	useWakeLock(running && !timeUp);

	// Each phase swaps its controls; when the focused one goes with them, focus the new
	// phase's main control (Start, Pause/Resume, the note) instead of dropping to the page.
	const phase = !mine ? "ready" : showFinish ? "finish" : "running";
	const startRef = useRef<HTMLButtonElement>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const noteRef = useRef<HTMLTextAreaElement>(null);
	const firstPhase = useRef(true);
	useEffect(() => {
		if (firstPhase.current) {
			firstPhase.current = false;
			return;
		}
		const focused = document.activeElement;
		if (focused && focused !== document.body && focused.id !== "main" && focused.isConnected)
			return;
		const target =
			phase === "ready"
				? startRef.current
				: phase === "running"
					? toggleRef.current
					: noteRef.current;
		target?.focus({ preventScroll: true });
	}, [phase]);

	// Time's up arrives while the screen is open: say so once.
	useEffect(() => {
		if (!timeUp || !mine) return;
		const key = `up:${mine.startedAt}`;
		if (lastAnnounced.current === key) return;
		lastAnnounced.current = key;
		announce(t("tracker.session.timeUp"));
	}, [timeUp, mine, t]);

	const start = () => {
		if (timer) return;
		primeBell();
		const preset = mode === "countdown" ? minutes * 60 : null;
		if (timerStore.start(habit.id, day, preset, label)) {
			setFinishing(false);
			setNote("");
			announce(t("tracker.session.started"));
		}
	};
	const pause = () => {
		timerStore.pause();
		announce(t("tracker.session.paused"));
	};
	const resume = () => {
		timerStore.resume();
		setFinishing(false);
		announce(t("tracker.session.running"));
	};
	const finish = () => {
		if (!mine) return;
		if (running && !timeUp) timerStore.pause();
		setFinishing(true);
	};
	const keepGoing = () => {
		timerStore.keepGoing();
		setFinishing(false);
		announce(t("tracker.session.running"));
	};
	const save = () => {
		const state = getTimer();
		if (!state || state.habitId !== habit.id) return;
		const now = Date.now();
		const seconds = timerSeconds(state, now);
		const saved = actions.addTrackerEntry(timerEntry(state, now, note));
		if (!saved) {
			toast.error(t("tracker.saveFailed"));
			return;
		}
		timerStore.clear();
		const latest = store.getState();
		const line = trackerDayLine(
			latest.data.habits[habit.id] ?? habit,
			trackerEntryIndexOf(latest.data.trackerEntries),
			state.day,
			today,
			t,
		);
		const message = t("tracker.session.saved", { duration: t.formatDuration(seconds) });
		toast(message, {
			description: line ?? name,
			action: { label: t("common.undo"), onClick: () => actions.deleteTrackerEntry(saved.id) },
		});
		announce(message);
		close();
	};
	const discard = () => {
		timerStore.clear();
		setFinishing(false);
		setNote("");
		toast(t("tracker.session.discarded"), { description: name });
		announce(t("tracker.session.discarded"));
		// The confirm dialog hands focus back to "Discard", which is gone by then: once it has
		// closed, Start takes it.
		let tries = 0;
		const refocus = () => {
			if (document.querySelector('[role="alertdialog"]') && tries++ < 20) {
				window.setTimeout(refocus, 50);
				return;
			}
			const focused = document.activeElement;
			if (!focused || focused === document.body || focused.id === "main") startRef.current?.focus();
		};
		window.setTimeout(refocus, 50);
	};

	// Space starts or pauses, Enter finishes, Esc goes back (the timer keeps running).
	const keys = useRef({ start, pause, resume, finish, close, showFinish, mine, running });
	keys.current = { start, pause, resume, finish, close, showFinish, mine, running };
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
			if (
				document.querySelector(
					'[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
				)
			)
				return;
			const k = keys.current;
			if (event.key === " ") {
				if (target?.closest("button, a, [role='radio']")) return;
				event.preventDefault();
				if (!k.mine) k.start();
				else if (k.showFinish) return;
				else if (k.running) k.pause();
				else k.resume();
			} else if (event.key === "Enter") {
				if (target?.closest("button, a")) return;
				if (k.mine && !k.showFinish) {
					event.preventDefault();
					k.finish();
				}
			} else if (event.key === "Escape") {
				event.preventDefault();
				k.close();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

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
					? t("tracker.session.of", { duration: t.formatDuration(mine.presetSec) })
					: null,
			]
				.filter(Boolean)
				.join(" · ")
		: null;
	const breathOn = breathing && running && !timeUp && !finishing;
	const phaseIn = breathOn ? (view?.elapsedMs ?? 0) % BREATH_MS < BREATH_IN_MS : false;
	const status = !mine
		? t("tracker.session.ready")
		: timeUp
			? t("tracker.session.timeUpShort")
			: running
				? breathOn
					? phaseIn
						? t("tracker.session.breatheIn")
						: t("tracker.session.breatheOut")
					: t("tracker.session.running")
				: t("tracker.session.paused");

	const allTopics = [...topics, ...extraTopics.filter((x) => !topics.includes(x))];
	const addTopic = () => {
		const value = topicDraft.trim().slice(0, 60);
		if (!value) return;
		if (!allTopics.some((x) => x.toLowerCase() === value.toLowerCase())) {
			setExtraTopics((list) => [...list, value]);
		}
		setLabel(value);
		setTopicDraft("");
	};

	return (
		<div style={style} className="flex flex-1 flex-col items-center gap-6 py-6 md:py-10">
			{other && otherHabit ? (
				<div className="flex w-full flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3.5 sm:flex-row sm:items-center">
					<p className="min-w-0 flex-1 text-ink text-small">
						<span className="font-semibold">
							{t("tracker.session.finishFirst", { habit: text.habit(otherHabit, "name") })}
						</span>{" "}
						{t("tracker.session.finishFirstBody")}
					</p>
					<Button asChild size="sm" variant="secondary" className="shrink-0">
						<Link to="/habits/$habitId/timer" params={{ habitId: otherHabit.id }}>
							{t("tracker.session.goTo", { habit: text.habit(otherHabit, "name") })}
						</Link>
					</Button>
				</div>
			) : null}

			<div className="relative grid aspect-square w-[min(76vw,300px)] place-items-center">
				<svg
					viewBox="0 0 200 200"
					aria-hidden="true"
					className="-rotate-90 absolute inset-0 size-full"
				>
					<circle cx="100" cy="100" r="92" fill="none" stroke="var(--habit-soft)" strokeWidth="6" />
					<circle
						cx="100"
						cy="100"
						r="92"
						fill="none"
						stroke={timeUp ? "var(--accent)" : "var(--habit)"}
						strokeWidth="6"
						strokeLinecap="round"
						strokeDasharray={2 * Math.PI * 92}
						strokeDashoffset={2 * Math.PI * 92 * (1 - Math.max(0, Math.min(1, progress)))}
						className="transition-[stroke-dashoffset] duration-300 ease-linear motion-reduce:transition-none"
					/>
				</svg>
				{breathing && mine && !reducedMotion ? (
					<span
						aria-hidden="true"
						className="absolute size-[72%] rounded-full bg-(--habit-softer) ease-in-out"
						style={{
							transform: `scale(${breathOn ? (phaseIn ? 1 : 0.72) : 0.86})`,
							transitionProperty: "transform",
							transitionDuration: `${breathOn ? (phaseIn ? BREATH_IN_MS : BREATH_MS - BREATH_IN_MS) : 600}ms`,
						}}
					/>
				) : null}
				<div className="relative flex flex-col items-center gap-1 text-center">
					<p className="text-ink-muted text-small" aria-live="polite">
						{status}
					</p>
					<p
						role="timer"
						aria-live="off"
						aria-label={`${clock} · ${status}`}
						className={cn(
							"font-display text-[4rem] tabular-nums leading-none sm:text-[4.5rem]",
							mine && !running && !timeUp ? "text-ink-muted" : "text-ink",
						)}
					>
						{clock}
					</p>
					<p className="min-h-5 max-w-[14rem] truncate text-ink-muted text-small">{sub}</p>
				</div>
			</div>

			{showFinish ? (
				<div className="flex w-full max-w-md flex-col gap-4">
					<p className="text-center font-display text-ink text-title">
						{timeUp
							? t("tracker.session.timeUp")
							: t("tracker.session.finished", {
									duration: t.formatDuration(mine ? timerSeconds(mine, Date.now()) : 0),
								})}
					</p>
					<div className="flex flex-col gap-1.5">
						<label htmlFor={noteId} className="font-medium text-ink text-small">
							{config.prompt === "learned"
								? t("tracker.session.learnedPrompt")
								: config.prompt === "felt"
									? t("tracker.session.feltPrompt")
									: t("tracker.note")}
						</label>
						<Textarea
							ref={noteRef}
							id={noteId}
							autoGrow
							minRows={2}
							maxRows={6}
							maxLength={500}
							value={note}
							placeholder={t("tracker.session.notePlaceholder")}
							onChange={(event) => setNote(event.target.value)}
						/>
					</div>
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<Button variant="ghost" onClick={() => setConfirmDiscard(true)}>
							{t("tracker.session.discard")}
						</Button>
						{timeUp ? (
							<Button variant="secondary" onClick={keepGoing}>
								<RotateCcw />
								{t("tracker.session.keepGoing")}
							</Button>
						) : (
							<Button variant="secondary" onClick={resume}>
								<Play />
								{t("tracker.session.resume")}
							</Button>
						)}
						<Button onClick={save}>
							<Check />
							{t("tracker.save")}
						</Button>
					</div>
				</div>
			) : mine ? (
				<div className="flex w-full max-w-md flex-col items-center gap-4">
					<div className="flex items-center gap-3">
						{running ? (
							<Button
								ref={toggleRef}
								size="lg"
								variant="secondary"
								onClick={pause}
								className="min-w-32"
							>
								<Pause />
								{t("tracker.session.pause")}
							</Button>
						) : (
							<Button
								ref={toggleRef}
								size="lg"
								variant="secondary"
								onClick={resume}
								className="min-w-32"
							>
								<Play />
								{t("tracker.session.resume")}
							</Button>
						)}
						<Button size="lg" onClick={finish} className="min-w-32">
							<Square className="fill-current" />
							{t("tracker.session.finish")}
						</Button>
					</div>
					<button
						type="button"
						onClick={() => setConfirmDiscard(true)}
						className="text-ink-muted text-small underline-offset-2 hover:text-ink hover:underline"
					>
						{t("tracker.session.discard")}
					</button>
				</div>
			) : (
				<div className="flex w-full max-w-md flex-col gap-5">
					<div className="flex flex-col gap-2">
						<ToggleGroup<"countdown" | "stopwatch">
							type="single"
							label={t("tracker.session.mode")}
							value={mode}
							onChange={(next) => next && setMode(next)}
							options={[
								{ value: "countdown", label: t("tracker.session.countdown") },
								{ value: "stopwatch", label: t("tracker.session.stopwatch") },
							]}
							className="justify-center"
						/>
						{mode === "countdown" ? (
							<ToggleGroup<number>
								type="single"
								size="sm"
								label={t("tracker.session.length")}
								value={minutes}
								onChange={(next) => next && setMinutes(next)}
								options={[...new Set([...LENGTHS, config.preset ?? 10])]
									.sort((a, b) => a - b)
									.map((m) => ({ value: m, label: t.formatDuration(m * 60) }))}
								className="justify-center"
							/>
						) : null}
					</div>
					<div className="flex flex-col gap-2">
						<span className="text-center font-medium text-ink-muted text-small" aria-hidden="true">
							{t("tracker.session.label")}
						</span>
						{allTopics.length ? (
							<ToggleGroup<string>
								type="single"
								size="sm"
								allowEmpty
								label={t("tracker.session.label")}
								value={label}
								onChange={setLabel}
								options={allTopics.map((topic) => ({ value: topic, label: topic }))}
								className="justify-center"
							/>
						) : null}
						<div className="mx-auto flex w-full max-w-xs gap-2">
							<input
								type="text"
								value={topicDraft}
								maxLength={60}
								aria-label={t("tracker.session.addTopic")}
								placeholder={t("tracker.session.addTopic")}
								onChange={(event) => setTopicDraft(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										addTopic();
									}
								}}
								className={cn(controlClass, "h-9 min-w-0 flex-1 text-small")}
							/>
							<Button
								size="sm"
								variant="secondary"
								onClick={addTopic}
								disabled={!topicDraft.trim()}
								aria-label={t("tracker.session.addTopic")}
							>
								<Plus />
							</Button>
						</div>
					</div>
					<Button
						ref={startRef}
						size="lg"
						onClick={start}
						disabled={!!other}
						className="mx-auto min-w-44"
					>
						<Play />
						{t("tracker.session.start")}
					</Button>
					<button
						type="button"
						onClick={() => openEntryComposer({ habitId: habit.id, day })}
						className="mx-auto text-ink-muted text-small underline-offset-2 hover:text-ink hover:underline"
					>
						{t("tracker.session.logManually")}
					</button>
				</div>
			)}

			<div className="mt-auto flex w-full max-w-md flex-col items-center gap-3 pt-4">
				<div className="flex items-center gap-3 text-ink-muted text-small">
					<Wind aria-hidden="true" className="size-4 shrink-0" />
					<label htmlFor={breathId}>{t("tracker.session.breathing")}</label>
					<Switch id={breathId} checked={breathing} onCheckedChange={setBreathing} />
				</div>
				<p className="hidden text-center text-ink-subtle text-tiny md:block">
					{t("tracker.session.keys")}
				</p>
			</div>

			<ConfirmDialog
				open={confirmDiscard}
				onOpenChange={setConfirmDiscard}
				title={t("tracker.session.discard")}
				body={t("tracker.session.discardConfirm")}
				confirmLabel={t("tracker.session.discard")}
				destructive
				onConfirm={discard}
			/>
		</div>
	);
}
