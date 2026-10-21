import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { type Habit, TRACKERS, type TrackerType, trackerHint, trackerName } from "@atomic/core";
import { Sparkles } from "lucide-react";
import { useCallback, useId, useSyncExternalStore } from "react";
import { Button } from "../ui/button";
import { useTrackerUI } from "./tracker-ui";

/** Habits whose suggestion was dismissed on this device (spec §5.8, D34). */
const DISMISSED_KEY = "atomic-habits:tracker-suggestions-dismissed";

const listeners = new Set<() => void>();

function readDismissed(): string {
	try {
		return localStorage.getItem(DISMISSED_KEY) ?? "[]";
	} catch {
		return "[]";
	}
}

function dismissedIds(raw: string): string[] {
	try {
		const value = JSON.parse(raw);
		return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

function dismiss(habitId: string): void {
	const ids = dismissedIds(readDismissed()).filter((id) => id !== habitId);
	try {
		// The newest 200 are enough; habits come and go.
		localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids, habitId].slice(-200)));
	} catch {
		// Storage unavailable: hidden until the page reloads.
		memory.add(habitId);
	}
	for (const listener of listeners) listener();
}

const memory = new Set<string>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key === DISMISSED_KEY) listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

function useDismissed(habitId: string): boolean {
	const raw = useSyncExternalStore(subscribe, readDismissed, () => "[]");
	return memory.has(habitId) || dismissedIds(raw).includes(habitId);
}

/**
 * "Make it interactive" (Annex K §4.1): on a plain habit whose name fits a
 * tracker ("Read 10 pages" → reading log), offer to log it in the app.
 * "Try it" opens the tracker settings prefilled; "Not now" hides it on this
 * device. Owner: T4.
 */
export function TrackerSuggestionCard({ habit, type }: { habit: Habit; type: TrackerType }) {
	const { t } = useT();
	const style = useHabitStyle(habit.color);
	const titleId = useId();
	const hidden = useDismissed(habit.id);
	const openSettings = useTrackerUI((s) => s.openSettings);
	const onDismiss = useCallback(() => dismiss(habit.id), [habit.id]);
	if (hidden || habit.archivedAt) return null;
	const def = TRACKERS[type];
	return (
		<section
			aria-labelledby={titleId}
			style={style}
			className="flex animate-fade-in flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center md:p-6"
		>
			<div className="flex min-w-0 flex-1 gap-4">
				<span
					aria-hidden="true"
					className="relative grid size-12 shrink-0 place-items-center rounded-lg bg-(--habit-soft) font-emoji text-2xl"
				>
					{def.emoji}
					<span className="-right-1.5 -bottom-1.5 absolute grid size-5 place-items-center rounded-full bg-accent text-on-accent ring-2 ring-surface">
						<Sparkles className="size-3" strokeWidth={2.5} />
					</span>
				</span>
				<div className="min-w-0">
					<p className="section-label">{t("tracker.suggestTitle")}</p>
					<h2 id={titleId} className="mt-0.5 break-words font-semibold text-ink">
						{trackerName(type, t)}
					</h2>
					<p className="mt-0.5 text-pretty text-ink-muted text-small">
						{trackerHint(type, t)} {t("tracker.suggestBody")}
					</p>
				</div>
			</div>
			<div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
				<Button variant="ghost" size="sm" onClick={onDismiss}>
					{t("tracker.suggestDismiss")}
				</Button>
				<Button size="sm" onClick={() => openSettings({ habitId: habit.id, type })}>
					{t("tracker.suggestTry")}
				</Button>
			</div>
		</section>
	);
}
